#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace chordtroller::dsp
{

/**
    A patch: everything a Juno front panel holds, plus the delay the J-6 added.

    The Juno-6 had no memory — patches arrived with the Juno-60 — but for an
    instrument meant to cover house, R&B and lo-fi the sound is half the style,
    so it gets a handful. Levels are 0..1, times are seconds, cutoff and HPF are
    positions on their sliders rather than hertz, because that is how the panel
    reads and how the triggers add to them.
*/
struct JunoPatch
{
    const char* name;

    float saw, pulse, sub, noise;        // DCO mix
    float pulseWidth, pwmDepth, lfoRate; // PWM from the LFO, the Juno's shimmer

    // No resting cutoff or resonance: the triggers own those outright and start
    // at zero. What the patch still decides about the filter is how far its own
    // envelope opens it — with the triggers released that envelope is the whole
    // filter, and it is what still tells a pad from a pluck.
    float envAmount, keyTrack, hpf;

    float attack, decay, sustain, release;
    float level;

    float delaySend, delayFeedback;
    int   delayDivision;                 // 0 eighth, 1 dotted eighth, 2 quarter
};

inline constexpr int kNumJunoPatches = 5;

inline const JunoPatch& junoPatch (int index) noexcept
{
    static const std::array<JunoPatch, kNumJunoPatches> patches
    {{
        // name        saw   pul   sub   noise  pw    pwm   lfo    env   key   hpf    A      D     S     R     lvl   dly   fb   div
        { "PAD",       0.80f,0.45f,0.30f,0.00f, 0.50f,0.35f,0.45f, 0.22f,0.30f,0.05f, 0.55f, 1.20f,0.80f,1.40f, 0.55f, 0.18f,0.35f,1 },
        { "STRAKAR",   1.00f,0.00f,0.15f,0.00f, 0.50f,0.00f,0.40f, 0.10f,0.30f,0.20f, 0.35f, 1.00f,0.90f,1.00f, 0.50f, 0.10f,0.30f,2 },
        { "STOT",      0.90f,0.25f,0.40f,0.00f, 0.50f,0.10f,0.80f, 0.60f,0.40f,0.05f, 0.003f,0.25f,0.30f,0.18f, 0.70f, 0.30f,0.42f,1 },
        { "PLOCK",     0.20f,0.80f,0.20f,0.00f, 0.30f,0.10f,0.60f, 0.70f,0.40f,0.08f, 0.002f,0.35f,0.00f,0.30f, 0.75f, 0.26f,0.45f,0 },
        { "BRASS",     1.00f,0.00f,0.20f,0.00f, 0.50f,0.00f,0.50f, 0.55f,0.35f,0.05f, 0.06f, 0.50f,0.70f,0.35f, 0.60f, 0.12f,0.30f,2 }
    }};

    return patches[(size_t) (((index % kNumJunoPatches) + kNumJunoPatches) % kNumJunoPatches)];
}

//==============================================================================

/**
    Where the two filter triggers land.

    Released is zero, not the patch. The trigger owns the whole range, so the
    entire sweep is under the finger instead of only the part above whatever the
    patch was already holding — half a trigger's travel spent getting back to
    where the sound started is half a trigger wasted.

    Shut does not mean silent: the patch's own envelope is added on top of this
    inside the voice, so with both triggers home a pluck still speaks and a pad
    still sighs. That envelope is what tells the patches apart down there.

    The cutoff is linear across its travel. The resonance is not: a ladder does
    almost nothing below a third of the way up, so a linear trigger would spend
    its first half saying nothing and its last few millimetres saying everything.
    The taper puts the range where the finger is. Same lesson the volume trigger
    taught, and the same shape.

    It lives here so the panel draws the same number the voices hear. Two places
    computing this would eventually disagree and there would be no way to tell
    which one was lying.
*/
struct FilterSweep { float cutoff, resonance; };

inline FilterSweep filterSweep (float cutoffTravel, float resonanceTravel) noexcept
{
    // Short of self-oscillation, which the ladder reaches at about 1.0. A
    // trigger that screams at the stop is a trigger with a dead end on it.
    constexpr float ceiling = 0.95f;
    constexpr float taper   = 0.6f;

    return { std::clamp (cutoffTravel, 0.0f, 1.0f),
             ceiling * std::pow (std::clamp (resonanceTravel, 0.0f, 1.0f), taper) };
}

//==============================================================================

/**
    One Juno voice.

    A DCO — sawtooth and pulse from one digitally controlled clock, a square an
    octave down, a little noise — into a four-pole lowpass that can sing, shaped
    by one envelope shared between filter and amplifier. That sharing is the
    Juno: it is why a Juno pluck brightens and dies in one gesture instead of
    two.

    The filter is a zero-delay-feedback ladder, solved rather than approximated,
    because the resonance has to reach self-oscillation without the filter
    blowing up or detuning as it gets there, and a naive digital ladder does
    both. A soft clip sits on the input to the feedback loop, which is where the
    IR3109 gets its warmth when it is pushed.
*/
class JunoVoice
{
public:
    void prepare (double sampleRateIn) noexcept
    {
        sampleRate = sampleRateIn;
        reset();
    }

    void reset() noexcept
    {
        active = gateOn = gateEnded = false;
        env = 0.0f;
        stage = Stage::idle;
        s1 = s2 = s3 = s4 = 0.0f;
        hpLow = 0.0f;
        note = -1;
        gateSamples = -1;
        stamp = 0;
    }

    void setPatch (const JunoPatch& p) noexcept
    {
        patch = &p;

        attackStep   = 1.0f / std::max (1.0f, (float) (sampleRate * p.attack));
        decayCoef    = coefficientFor (p.decay);
        releaseCoef  = coefficientFor (p.release);
        hpfCoef      = 1.0f - std::exp (-2.0f * kPi
                           * (20.0f * std::pow (2.0f, p.hpf * 5.3f)) / (float) sampleRate);
    }

    /** A gate of zero or less holds until noteOff — pads, and anything latched. */
    void noteOn (int midiNote, float velocityIn, int gateLength, std::uint64_t order) noexcept
    {
        // The oscillators keep running through a retrigger. Resetting them is
        // a step in the waveform and it clicks — the same rule the strings and
        // the accompaniment follow.
        if (! active)
        {
            phase = 0.0f;
            subPhase = 0.0f;
        }

        note        = midiNote;
        velocity    = velocityIn;
        gateSamples = gateLength > 0 ? gateLength : -1;
        increment   = (float) (440.0 * std::pow (2.0, (midiNote - 69) / 12.0) / sampleRate);

        stage  = Stage::attack;
        active = true;
        gateOn = true;
        gateEnded = false;
        stamp  = order;
    }

    void noteOff() noexcept
    {
        if (! gateOn)
            return;

        gateOn = false;
        stage  = Stage::release;
    }

    bool          isActive() const noexcept { return active; }
    bool          isGateOn() const noexcept { return gateOn; }
    int           midiNote() const noexcept { return note; }
    std::uint64_t age()      const noexcept { return stamp; }

    /** True once, on the sample an automatic gate ran out — so MIDI out can
        send the note-off exactly where the sound let go. */
    bool takeGateEnded() noexcept
    {
        const bool ended = gateEnded;
        gateEnded = false;
        return ended;
    }

    /**
        `cutoff` and `resonance` are slider positions for this block, already
        including whatever the triggers add. `envScale` is how hard the right
        stick is pushed, so a light touch opens the filter less than a full one.
    */
    float process (float lfo, float cutoff, float resonance, float envScale) noexcept
    {
        if (! active || patch == nullptr)
            return 0.0f;

        if (gateSamples > 0 && --gateSamples == 0)
        {
            noteOff();
            gateEnded = true;
        }

        advanceEnvelope();

        if (! active)
            return 0.0f;

        const auto& p = *patch;

        // DCO
        const float width = std::clamp (p.pulseWidth + lfo * p.pwmDepth * 0.4f, 0.05f, 0.95f);
        const float dt    = increment;

        const float saw = (2.0f * phase - 1.0f) - blep (phase, dt);

        float pulse = phase < width ? 1.0f : -1.0f;
        pulse += blep (phase, dt);
        pulse -= blep (wrap (phase + 1.0f - width), dt);

        float sub = subPhase < 0.5f ? 1.0f : -1.0f;
        sub += blep (subPhase, dt * 0.5f);
        sub -= blep (wrap (subPhase + 0.5f), dt * 0.5f);

        const float noise = whiteNoise();

        const float mixTotal = std::max (1.0f, p.saw + p.pulse + p.sub + p.noise);
        float x = (saw * p.saw + pulse * p.pulse + sub * p.sub + noise * p.noise) / mixTotal;

        phase += dt;
        if (phase >= 1.0f) phase -= 1.0f;

        subPhase += dt * 0.5f;
        if (subPhase >= 1.0f) subPhase -= 1.0f;

        // HPF, the Juno's own: a gentle one-pole that thins the bottom.
        hpLow += hpfCoef * (x - hpLow);
        x -= hpLow;

        // VCF: ten octaves across the slider, the envelope and key follow added
        // on top in the same units so they sweep musically rather than in hertz.
        const float position = std::clamp (cutoff
                                             + p.envAmount * env * envScale
                                             + p.keyTrack * (float) (note - 60) / 120.0f,
                                           0.0f, 1.0f);

        const float hz = std::min (20.0f * std::pow (2.0f, position * 10.0f),
                                   0.45f * (float) sampleRate);

        const float g  = std::tan (kPi * hz / (float) sampleRate);
        const float G  = g / (1.0f + g);
        const float k  = std::clamp (resonance, 0.0f, 1.0f) * 3.85f;

        const float S  = (G * G * G * s1 + G * G * s2 + G * s3 + s4) / (1.0f + g);
        const float u  = softClip ((x - k * S) / (1.0f + k * G * G * G * G));

        float v = (u  - s1) * G; const float y1 = v + s1; s1 = y1 + v;
        v = (y1 - s2) * G;       const float y2 = v + s2; s2 = y2 + v;
        v = (y2 - s3) * G;       const float y3 = v + s3; s3 = y3 + v;
        v = (y3 - s4) * G;       const float y4 = v + s4; s4 = y4 + v;

        // A ladder loses passband level as resonance rises. Giving some of it
        // back keeps a resonant patch from sounding like a quieter one.
        const float filtered = y4 * (1.0f + k * 0.5f);

        return filtered * env * velocity * p.level;
    }

private:
    enum class Stage { idle, attack, decay, sustain, release };

    static constexpr float kPi = 3.14159265358979f;

    float coefficientFor (float seconds) const noexcept
    {
        return std::pow (0.001f, 1.0f / std::max (1.0f, (float) (sampleRate * seconds)));
    }

    void advanceEnvelope() noexcept
    {
        switch (stage)
        {
            case Stage::attack:
                env += attackStep;
                if (env >= 1.0f) { env = 1.0f; stage = Stage::decay; }
                break;

            case Stage::decay:
                env = patch->sustain + (env - patch->sustain) * decayCoef;
                if (std::abs (env - patch->sustain) < 1.0e-3f) stage = Stage::sustain;
                break;

            case Stage::sustain:
                env = patch->sustain;

                // A sustain of zero is a pluck: the note is over even with the
                // gate held, and holding a voice nobody can hear starves the rest.
                if (env <= 1.0e-4f) { active = false; stage = Stage::idle; }
                break;

            case Stage::release:
                env *= releaseCoef;
                if (env < 1.0e-4f) { env = 0.0f; active = false; stage = Stage::idle; }
                break;

            case Stage::idle:
                break;
        }
    }

    static float wrap (float p) noexcept { return p >= 1.0f ? p - 1.0f : p; }

    static float blep (float t, float dt) noexcept
    {
        if (dt <= 0.0f) return 0.0f;
        if (t < dt)        { t /= dt;            return t + t - t * t - 1.0f; }
        if (t > 1.0f - dt) { t = (t - 1.0f) / dt; return t * t + t + t + 1.0f; }
        return 0.0f;
    }

    /** Rational tanh: cheap, smooth, and exact enough where it matters. */
    static float softClip (float x) noexcept
    {
        x = std::clamp (x, -3.0f, 3.0f);
        return x * (27.0f + x * x) / (27.0f + 9.0f * x * x);
    }

    float whiteNoise() noexcept
    {
        rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
        return (float) (std::int32_t) rng * (1.0f / 2147483648.0f);
    }

    const JunoPatch* patch = nullptr;
    double sampleRate = 44100.0;

    float phase = 0.0f, subPhase = 0.0f, increment = 0.0f;
    float env = 0.0f, velocity = 1.0f;
    float attackStep = 0.01f, decayCoef = 0.999f, releaseCoef = 0.999f;
    float hpfCoef = 0.001f, hpLow = 0.0f;
    float s1 = 0.0f, s2 = 0.0f, s3 = 0.0f, s4 = 0.0f;

    Stage stage = Stage::idle;
    bool  active = false, gateOn = false, gateEnded = false;
    int   note = -1, gateSamples = -1;
    std::uint64_t stamp = 0;
    std::uint32_t rng = 0x2545f491u;
};

} // namespace chordtroller::dsp
