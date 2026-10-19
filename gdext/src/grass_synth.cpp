#include "grass_synth.h"

#include <godot_cpp/classes/audio_server.hpp>
#include <godot_cpp/core/class_db.hpp>

#include <cmath>

namespace godot
{

GrassSynth::GrassSynth()
    : queue (std::make_shared<SynthQueue>())
{
    chordtroller::music::Chord c;
    strings.build (c);
}

Ref<AudioStreamPlayback> GrassSynth::_instantiate_playback() const
{
    Ref<GrassSynthPlayback> p;
    p.instantiate();
    p->queue = queue;
    return p;
}

void GrassSynth::send (int type, int i, float a, float b, float c)
{
    queue->push ({ type, i, a, b, c });
}

void GrassSynth::set_chord (int root, int quality)
{
    chordtroller::music::Chord c;
    c.rootPitchClass = ((root % 12) + 12) % 12;
    c.quality = quality == 1 ? chordtroller::music::Quality::minor
              : quality == 2 ? chordtroller::music::Quality::dominant7
                             : chordtroller::music::Quality::major;
    strings.build (c);
    send (SynthCommand::Chord, root, (float) quality);
}

void GrassSynth::pluck (int string_index, float velocity, float delay_seconds)
{
    send (SynthCommand::Pluck, string_index, velocity, delay_seconds);
}

void GrassSynth::set_voice (int index)                  { send (SynthCommand::Voice, index); }
void GrassSynth::set_ring (float seconds)               { send (SynthCommand::Ring, 0, seconds); }
void GrassSynth::set_drone (float level)                { send (SynthCommand::Drone, 0, level); }
void GrassSynth::set_drone_brightness (float position)  { send (SynthCommand::DroneBrightness, 0, position); }
void GrassSynth::set_delay (float send_, float feedback, float bpm) { send (SynthCommand::Delay, 0, send_, feedback, bpm); }
void GrassSynth::set_ensemble (float mix)               { send (SynthCommand::Ensemble, 0, mix); }
void GrassSynth::set_master (float gain)                { send (SynthCommand::Master, 0, gain); }
void GrassSynth::all_off()                              { send (SynthCommand::AllOff); }
void GrassSynth::set_tone (float tone)                  { send (SynthCommand::Tone, 0, tone); }

int GrassSynth::get_string_midi (int index) const
{
    return index >= 0 && index < strings.count ? strings.midi[(size_t) index] : -1;
}

PackedStringArray GrassSynth::get_voice_names() const
{
    PackedStringArray out;
    for (int k = 0; k < chordtroller::dsp::kNumVoices; ++k)
        out.push_back (chordtroller::dsp::voiceSpec (k).name);
    return out;
}

void GrassSynth::_bind_methods()
{
    ClassDB::bind_method (D_METHOD ("set_chord", "root", "quality"), &GrassSynth::set_chord);
    ClassDB::bind_method (D_METHOD ("pluck", "string_index", "velocity", "delay_seconds"), &GrassSynth::pluck, DEFVAL (0.0f));
    ClassDB::bind_method (D_METHOD ("set_voice", "index"), &GrassSynth::set_voice);
    ClassDB::bind_method (D_METHOD ("set_ring", "seconds"), &GrassSynth::set_ring);
    ClassDB::bind_method (D_METHOD ("set_drone", "level"), &GrassSynth::set_drone);
    ClassDB::bind_method (D_METHOD ("set_drone_brightness", "position"), &GrassSynth::set_drone_brightness);
    ClassDB::bind_method (D_METHOD ("set_delay", "send", "feedback", "bpm"), &GrassSynth::set_delay);
    ClassDB::bind_method (D_METHOD ("set_ensemble", "mix"), &GrassSynth::set_ensemble);
    ClassDB::bind_method (D_METHOD ("set_master", "gain"), &GrassSynth::set_master);
    ClassDB::bind_method (D_METHOD ("all_off"), &GrassSynth::all_off);
    ClassDB::bind_method (D_METHOD ("set_tone", "tone"), &GrassSynth::set_tone);
    ClassDB::bind_method (D_METHOD ("get_string_count"), &GrassSynth::get_string_count);
    ClassDB::bind_method (D_METHOD ("get_string_midi", "index"), &GrassSynth::get_string_midi);
    ClassDB::bind_method (D_METHOD ("get_voice_names"), &GrassSynth::get_voice_names);
}

//==============================================================================

void GrassSynthPlayback::_start (double)
{
    if (! engine)
    {
        engine = std::make_unique<touchgrass::GrassEngine>();
        engine->prepare (AudioServer::get_singleton()->get_mix_rate());
    }
    playing = true;
}

void GrassSynthPlayback::_stop()
{
    playing = false;
}

void GrassSynthPlayback::apply (const SynthCommand& c)
{
    auto& e = *engine;
    switch (c.type)
    {
        case SynthCommand::Pluck:
        {
            const int delay = (int) std::lround (std::max (0.0f, c.b) * AudioServer::get_singleton()->get_mix_rate());
            e.pluck (c.i, c.a, delay);
            break;
        }
        case SynthCommand::Chord:           e.setChord (c.i, (int) c.a); break;
        case SynthCommand::Voice:           e.setVoice (c.i); break;
        case SynthCommand::Ring:            e.setRing (c.a); break;
        case SynthCommand::Drone:           e.setDroneLevel (c.a); break;
        case SynthCommand::DroneBrightness: e.setDroneBrightness (c.a); break;
        case SynthCommand::Delay:           e.setDelay (c.a, c.b, c.c); break;
        case SynthCommand::Ensemble:        e.setEnsembleMix (c.a); break;
        case SynthCommand::Master:          e.setMaster (c.a); break;
        case SynthCommand::AllOff:          e.allOff(); break;
        case SynthCommand::Tone:            e.setTone (c.a); break;
        default: break;
    }
}

int32_t GrassSynthPlayback::_mix (AudioFrame* buffer, float, int32_t frames)
{
    if (! playing || ! engine)
    {
        for (int32_t i = 0; i < frames; ++i)
            buffer[i] = { 0.0f, 0.0f };
        return frames;
    }

    SynthCommand c;
    while (queue && queue->pop (c))
        apply (c);

    if ((int32_t) left.size() < frames)
    {
        left.resize ((size_t) frames);
        right.resize ((size_t) frames);
    }

    engine->render (left.data(), right.data(), frames);

    for (int32_t i = 0; i < frames; ++i)
    {
        buffer[i].left = left[(size_t) i];
        buffer[i].right = right[(size_t) i];
    }
    return frames;
}

} // namespace godot
