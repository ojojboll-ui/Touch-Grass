#pragma once

#include "GrassEngine.h"

#include <godot_cpp/classes/audio_stream.hpp>
#include <godot_cpp/classes/audio_stream_playback.hpp>
#include <godot_cpp/classes/audio_frame.hpp>

#include <atomic>
#include <cstdint>
#include <memory>
#include <vector>

namespace godot
{

/** What the game asks of the instrument, carried to the audio thread. */
struct SynthCommand
{
    enum Type : int { Pluck, Chord, Voice, Ring, Drone, DroneBrightness, Delay, Ensemble, Master, AllOff, Tone };
    int   type;
    int   i;
    float a, b, c;
};

/** One writer (the game), one reader (the mix): no locks on the audio thread. */
class SynthQueue
{
public:
    bool push (const SynthCommand& c)
    {
        const uint32_t h = head.load (std::memory_order_relaxed);
        const uint32_t next = (h + 1) % kSize;
        if (next == tail.load (std::memory_order_acquire))
            return false;
        items[h] = c;
        head.store (next, std::memory_order_release);
        return true;
    }

    bool pop (SynthCommand& c)
    {
        const uint32_t t = tail.load (std::memory_order_relaxed);
        if (t == head.load (std::memory_order_acquire))
            return false;
        c = items[t];
        tail.store ((t + 1) % kSize, std::memory_order_release);
        return true;
    }

private:
    static constexpr uint32_t kSize = 2048;
    SynthCommand items[kSize] {};
    std::atomic<uint32_t> head { 0 }, tail { 0 };
};

/**
    The Touch Grass instrument as an AudioStream: play it on an
    AudioStreamPlayer and call its methods from the game. Each call is queued
    and carried out at the start of the next mix, so nothing here waits on the
    audio thread.
*/
class GrassSynth : public AudioStream
{
    GDCLASS (GrassSynth, AudioStream)

public:
    GrassSynth();

    Ref<AudioStreamPlayback> _instantiate_playback() const override;
    String _get_stream_name() const override { return "GrassSynth"; }
    double _get_length() const override { return 0.0; }
    bool _is_monophonic() const override { return true; }

    void set_chord (int root, int quality);
    void pluck (int string_index, float velocity, float delay_seconds);
    void set_voice (int index);
    void set_ring (float seconds);
    void set_drone (float level);
    void set_drone_brightness (float position);
    void set_delay (float send, float feedback, float bpm);
    void set_ensemble (float mix);
    void set_master (float gain);
    void set_tone (float tone);
    void all_off();

    int get_string_count() const { return strings.count; }
    int get_string_midi (int index) const;
    PackedStringArray get_voice_names() const;

protected:
    static void _bind_methods();

private:
    void send (int type, int i = 0, float a = 0.0f, float b = 0.0f, float c = 0.0f);

    std::shared_ptr<SynthQueue> queue;
    chordtroller::music::StringSet strings;   // the game's copy, for drawing and mapping
};

class GrassSynthPlayback : public AudioStreamPlayback
{
    GDCLASS (GrassSynthPlayback, AudioStreamPlayback)

public:
    void _start (double from_pos) override;
    void _stop() override;
    bool _is_playing() const override { return playing; }
    int32_t _mix (AudioFrame* buffer, float rate_scale, int32_t frames) override;
    double _get_playback_position() const override { return 0.0; }

    std::shared_ptr<SynthQueue> queue;

protected:
    static void _bind_methods() {}

private:
    void apply (const SynthCommand& c);

    std::unique_ptr<touchgrass::GrassEngine> engine;
    std::vector<float> left, right;
    bool playing = false;
};

} // namespace godot
