#pragma once

#include "dsp/Ensemble.h"
#include "dsp/JunoVoice.h"
#include "dsp/PluckVoice.h"
#include "dsp/TempoDelay.h"
#include "dsp/VoiceSpec.h"
#include "music/ChordRing.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace touchgrass
{

/**
    Touch Grass's instrument: Chordtroller's Omnichord strings played by
    position instead of by a stick's rate, with a Juno pad held under them.

    Nothing here knows about Godot, so it can be rendered offline and tested
    with a plain compiler (test/enginetest.cpp).

    Plucks are scheduled. The hand is seen thirty times a second, and a sweep
    crosses several strings between two looks; the caller works out how far into
    the frame each crossing happened and asks for the pluck that many samples
    from now, so a sweep sounds as even as the hand moved instead of arriving
    in clumps.

    Signal path: strings and drone, mono, into the Juno ensemble (which is most
    of the Omnichord sound and suits the pad too), then the ping-pong delay,
    then the master level and a soft clip. Reverb is left to Godot's bus.
*/
class GrassEngine
{
public:
    static constexpr int kPluckVoices = 48;
    static constexpr int kDroneVoices = 8;
    static constexpr int kMaxPending  = 128;

    enum Quality { kMajor = 0, kMinor = 1, kSeventh = 2, kMajor7 = 3, kMinor7 = 4 };

    static chordtroller::music::Chord makeChord (int rootPitchClass, int quality) noexcept
    {
        using Q = chordtroller::music::Quality;
        chordtroller::music::Chord c;
        c.rootPitchClass = ((rootPitchClass % 12) + 12) % 12;
        c.quality = quality == kMinor   ? Q::minor
                  : quality == kSeventh ? Q::dominant7
                  : quality == kMajor7  ? Q::major7
                  : quality == kMinor7  ? Q::minor7
                                        : Q::major;
        return c;
    }

    /** The Omnichord's 13 strings for a chord, in plate order. */
    static chordtroller::music::StringSet plate (int rootPitchClass, int quality) noexcept
    {
        chordtroller::music::StringSet s;
        s.build (makeChord (rootPitchClass, quality));
        return s;
    }

    void prepare (double sampleRateIn)
    {
        sampleRate = sampleRateIn;

        for (auto& v : plucks)
            v.prepare (sampleRateIn);

        for (auto& v : drone)
        {
            v.prepare (sampleRateIn);
            v.setPatch (chordtroller::dsp::junoPatch (0));   // PAD
        }

        ensemble.prepare (sampleRateIn);
        ensemble.setRate (0.45f);
        ensemble.setMix (ensembleMix);

        delay.prepare (sampleRateIn);
        delay.setTiming (delayBpm, 1);
        delay.setAmount (delaySend, delayFeedback);

        pendingCount = 0;
        updateDecay();
        prepared = true;
    }

    bool isPrepared() const noexcept { return prepared; }

    /** Root 0..11 (C = 0); quality major, minor, seventh, major seventh or
        minor seventh. Sets the plate for pluck() and the chord the drone holds. */
    void setChord (int rootPitchClass, int quality) noexcept
    {
        const auto c = makeChord (rootPitchClass, quality);

        const bool changed = ! haveChord || c != chord;
        chord = c;
        haveChord = true;
        strings.build (chord);

        if (changed)
            restrikeDrone();
    }

    /** Pluck plate string `index` (0..12, plate order) `delaySamples` from now. */
    void pluck (int index, float velocity, int delaySamples) noexcept
    {
        if (pendingCount >= kMaxPending)
            return;

        if (index < 0 || index >= strings.count)
            return;

        pluckNote (strings.midi[(size_t) index], velocity, delaySamples);
    }

    /** Pluck a note by MIDI number, whatever the plate: several plates (chords)
        can sound at once, each hand on its own. */
    void pluckNote (int midiNote, float velocity, int delaySamples) noexcept
    {
        if (pendingCount >= kMaxPending)
            return;

        pending[(size_t) pendingCount++] = { midiNote, std::clamp (velocity, 0.0f, 1.0f), std::max (0, delaySamples) };
    }

    void setVoice (int index) noexcept
    {
        voiceIndex = ((index % chordtroller::dsp::kNumVoices) + chordtroller::dsp::kNumVoices) % chordtroller::dsp::kNumVoices;
        updateDecay();
    }

    /** How long a string rings, in seconds, before the voice's own scale. */
    void setRing (float seconds) noexcept
    {
        ringSeconds = std::clamp (seconds, 0.2f, 30.0f);
        updateDecay();
    }

    void setDroneLevel (float level) noexcept { droneTarget = std::clamp (level, 0.0f, 1.0f); }

    /** Where the pad's filter sits, as a slider position 0..1. */
    void setDroneBrightness (float position) noexcept { droneCutoff = std::clamp (position, 0.0f, 1.0f); }

    void setDelay (float send, float feedback, float bpm) noexcept
    {
        delaySend = send;
        delayFeedback = feedback;
        delayBpm = bpm;

        if (prepared)
        {
            delay.setAmount (send, feedback);
            delay.setTiming (bpm, 1);
        }
    }

    void setEnsembleMix (float mix) noexcept
    {
        ensembleMix = mix;
        ensemble.setMix (mix);
    }

    void setMaster (float gain) noexcept { masterTarget = std::clamp (gain, 0.0f, 2.0f); }

    /** How bright the strings sound, 0..1: a lowpass over them from about
        900 Hz to the top of hearing. The hand sets it from how deep it is in
        the grass, so pressing in opens the sound as well as raising it. */
    void setTone (float tone01) noexcept { toneTarget = std::clamp (tone01, 0.0f, 1.0f); }

    void allOff() noexcept
    {
        pendingCount = 0;

        for (auto& v : plucks)
            v.stopQuickly();

        for (auto& v : drone)
            v.noteOff();
    }

    int stringCount() const noexcept { return strings.count; }

    int stringMidi (int index) const noexcept
    {
        return index >= 0 && index < strings.count ? strings.midi[(size_t) index] : -1;
    }

    int activePlucks() const noexcept
    {
        int n = 0;

        for (const auto& v : plucks)
            if (v.isActive())
                ++n;

        return n;
    }

    /** Renders `n` samples, overwriting left and right. */
    void render (float* left, float* right, int n) noexcept
    {
        for (int i = 0; i < n; ++i)
        {
            firePending();

            float strings = 0.0f;

            for (auto& v : plucks)
                strings += v.process();

            // tone: a one-pole TPT lowpass, its cutoff gliding with the hand
            tone += (toneTarget - tone) * 0.002f;
            const float fc = std::min (900.0f * std::exp2 (tone * 4.2f), 0.45f * (float) sampleRate);
            const float g  = std::tan (3.14159265f * fc / (float) sampleRate);
            const float v  = (strings - toneState) * (g / (1.0f + g));
            const float lp = v + toneState;
            toneState = lp + v;
            strings = lp;

            // The pad's level and the master glide, so a slider never steps.
            droneLevel += (droneTarget - droneLevel) * 0.0005f;
            master     += (masterTarget - master) * 0.001f;

            float pad = 0.0f;

            if (droneLevel > 1.0e-4f || anyDroneActive)
            {
                lfoPhase += (double) chordtroller::dsp::junoPatch (0).lfoRate / sampleRate;
                if (lfoPhase >= 1.0) lfoPhase -= 1.0;
                const float lfo = (float) std::sin (2.0 * 3.14159265358979 * lfoPhase);

                anyDroneActive = false;

                for (auto& v : drone)
                {
                    if (v.isActive())
                    {
                        anyDroneActive = true;
                        pad += v.process (lfo, droneCutoff, 0.12f, 1.0f);
                    }
                }
            }

            const float mono = strings * kStringGain + pad * droneLevel * kDroneGain;

            float l, r;
            ensemble.process (mono, l, r);
            delay.process (l, r);

            left[i]  = softLimit (l * master);
            right[i] = softLimit (r * master);
        }
    }

private:
    // Chordtroller ran its strings at 0.10 into a bus with more gain after it;
    // here this is the last stage before the soft limit, so it carries that gain.
    static constexpr float kStringGain = 0.38f;
    static constexpr float kDroneGain  = 1.1f;

    struct Pending { int note; float velocity; int samplesLeft; };

    void firePending() noexcept
    {
        for (int k = 0; k < pendingCount;)
        {
            auto& p = pending[(size_t) k];

            if (p.samplesLeft-- > 0)
            {
                ++k;
                continue;
            }

            startNote (p.note, p.velocity);
            pending[(size_t) k] = pending[(size_t) --pendingCount];
        }
    }

    // A voice's "string" is its MIDI note: the same note struck again takes its
    // own voice back, from whichever plate it came.
    void startNote (int note, float velocity) noexcept
    {
        if (note < 0 || note > 127)
            return;

        const float freq = 440.0f * std::pow (2.0f, (float) (note - 69) / 12.0f);

        allocate (note)->start (freq, velocity, decayCoefficient,
                                chordtroller::dsp::voiceSpec (voiceIndex), note, ++stamp);
    }

    /** Chordtroller's rule: a ringing string takes its own note back, then a
        free voice, then the oldest. */
    chordtroller::dsp::PluckVoice* allocate (int index) noexcept
    {
        for (auto& v : plucks)
            if (v.isActive() && v.string() == index)
                return &v;

        for (auto& v : plucks)
            if (! v.isActive())
                return &v;

        auto* oldest = &plucks[0];

        for (auto& v : plucks)
            if (v.age() < oldest->age())
                oldest = &v;

        return oldest;
    }

    void updateDecay() noexcept
    {
        const float len = ringSeconds * chordtroller::dsp::voiceSpec (voiceIndex).decayScale;
        decayCoefficient = std::pow (0.001f, 1.0f / std::max (1.0f, (float) (sampleRate * (double) len)));

        for (auto& v : plucks)
            if (v.isActive())
                v.setDecayCoefficient (decayCoefficient);
    }

    /**
        The pad follows the chord: the old notes let go on their own release
        while the new ones swell in, which is the crossfade. An open voicing low
        in the plate's register: root, the colour tone above it, the third an
        octave up, and the root again on top.
    */
    void restrikeDrone() noexcept
    {
        for (auto& v : drone)
            v.noteOff();

        const int pc     = chord.rootPitchClass;
        const int base   = pc <= 5 ? 48 + pc : 36 + pc;
        const int third  = chordtroller::music::chordThird (chord.quality);
        const int colour = chordtroller::music::chordColourTone (chord.quality);
        const int notes[4] = { base, base + colour, base + 12 + third, base + 12 };
        const float vel[4] = { 0.75f, 0.6f, 0.55f, 0.45f };

        for (int k = 0; k < 4; ++k)
        {
            auto* v = freeDrone();
            v->noteOn (notes[k], vel[k], 0, ++droneStamp);
        }

        anyDroneActive = true;
    }

    chordtroller::dsp::JunoVoice* freeDrone() noexcept
    {
        for (auto& v : drone)
            if (! v.isActive())
                return &v;

        // Prefer one already letting go over one still held.
        chordtroller::dsp::JunoVoice* oldest = nullptr;

        for (auto& v : drone)
            if (! v.isGateOn() && (oldest == nullptr || v.age() < oldest->age()))
                oldest = &v;

        if (oldest != nullptr)
            return oldest;

        oldest = &drone[0];

        for (auto& v : drone)
            if (v.age() < oldest->age())
                oldest = &v;

        return oldest;
    }

    static float softLimit (float x) noexcept
    {
        x = std::clamp (x, -3.0f, 3.0f);
        return x * (27.0f + x * x) / (27.0f + 9.0f * x * x);
    }

    double sampleRate = 48000.0;
    bool   prepared = false;

    std::array<chordtroller::dsp::PluckVoice, kPluckVoices> plucks;
    std::array<chordtroller::dsp::JunoVoice, kDroneVoices> drone;
    chordtroller::dsp::Ensemble   ensemble;
    chordtroller::dsp::TempoDelay delay;

    chordtroller::music::Chord     chord;
    chordtroller::music::StringSet strings;
    bool haveChord = false;

    std::array<Pending, kMaxPending> pending {};
    int pendingCount = 0;

    int   voiceIndex = 1;           // HARPA: rounder than the OM-84 pulse, suits the meadow
    float ringSeconds = 3.5f;
    float decayCoefficient = 0.9999f;
    std::uint64_t stamp = 0, droneStamp = 0;

    float droneTarget = 0.35f, droneLevel = 0.0f, droneCutoff = 0.42f;
    bool  anyDroneActive = false;
    double lfoPhase = 0.0;

    float ensembleMix = 0.5f;
    float delaySend = 0.22f, delayFeedback = 0.38f, delayBpm = 72.0f;
    float masterTarget = 0.8f, master = 0.8f;
    float toneTarget = 0.75f, tone = 0.75f, toneState = 0.0f;
};

} // namespace touchgrass
