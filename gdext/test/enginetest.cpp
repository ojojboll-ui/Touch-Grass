#define _CRT_SECURE_NO_WARNINGS
// Offline checks of GrassEngine, no Godot needed. build.bat test
//
// Renders a sweep over the plate, a chord change and the drone, writes
// enginetest.wav to listen to, and checks: the plate's notes, that it sounds
// and stays finite, that a sweep spread over time is not one clump, that the
// drone follows the chord, and that block size changes nothing.

#include "../src/GrassEngine.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

static int failures = 0;
#define CHECK(cond, ...) do { if (!(cond)) { ++failures; std::printf ("FAIL  "); std::printf (__VA_ARGS__); std::printf ("\n"); } else { std::printf ("ok    "); std::printf (__VA_ARGS__); std::printf ("\n"); } } while (0)

static const double kRate = 48000.0;

struct Take { std::vector<float> l, r; };

// The scripted performance: C major sweep up, then down, F chord, minor, seventh.
static Take perform (int block)
{
    touchgrass::GrassEngine e;
    e.prepare (kRate);
    e.setChord (0, touchgrass::GrassEngine::kMajor);

    const int total = (int) (kRate * 9.0);
    Take t;
    t.l.assign ((size_t) total, 0.0f);
    t.r.assign ((size_t) total, 0.0f);

    struct Event { double at; int kind; int a; int b; };
    std::vector<Event> script;
    for (int s = 0; s < 13; ++s) script.push_back ({ 0.2 + s * 0.045, 0, s, 0 });
    for (int s = 12; s >= 0; --s) script.push_back ({ 1.6 + (12 - s) * 0.03, 0, s, 0 });
    script.push_back ({ 3.0, 1, 5, touchgrass::GrassEngine::kMajor });
    for (int s = 0; s < 13; ++s) script.push_back ({ 3.4 + s * 0.06, 0, s, 0 });
    script.push_back ({ 5.0, 1, 9, touchgrass::GrassEngine::kMinor });
    for (int s = 3; s < 10; ++s) script.push_back ({ 5.3 + s * 0.08, 0, s, 0 });
    script.push_back ({ 7.0, 1, 7, touchgrass::GrassEngine::kSeventh });
    for (int s = 12; s >= 0; --s) script.push_back ({ 7.2 + (12 - s) * 0.05, 0, s, 0 });

    size_t next = 0;
    for (int pos = 0; pos < total; pos += block)
    {
        const int end = std::min (pos + block, total);
        int cursor = pos;
        // Plucks in this block are handed over with their offset inside it, as the
        // Godot side does with the crossing time. A chord change takes effect where
        // it is called, so the block is rendered up to it first.
        while (next < script.size() && script[next].at * kRate < end)
        {
            const auto& ev = script[next++];
            const int at = std::max (cursor, (int) std::lround (ev.at * kRate));
            if (ev.kind == 0)
            {
                e.pluck (ev.a, 0.8f, at - cursor);
            }
            else
            {
                e.render (&t.l[(size_t) cursor], &t.r[(size_t) cursor], at - cursor);
                cursor = at;
                e.setChord (ev.a, ev.b);
            }
        }
        e.render (&t.l[(size_t) cursor], &t.r[(size_t) cursor], end - cursor);
    }
    return t;
}

static void writeWav (const char* path, const Take& t)
{
    FILE* f = std::fopen (path, "wb");
    if (! f) return;
    const unsigned n = (unsigned) t.l.size();
    const unsigned dataBytes = n * 2 * 2;
    auto u32 = [f] (unsigned v) { std::fwrite (&v, 4, 1, f); };
    auto u16 = [f] (unsigned short v) { std::fwrite (&v, 2, 1, f); };
    std::fwrite ("RIFF", 1, 4, f); u32 (36 + dataBytes); std::fwrite ("WAVEfmt ", 1, 8, f);
    u32 (16); u16 (1); u16 (2); u32 ((unsigned) kRate); u32 ((unsigned) kRate * 4); u16 (4); u16 (16);
    std::fwrite ("data", 1, 4, f); u32 (dataBytes);
    for (unsigned i = 0; i < n; ++i)
    {
        short s[2] = { (short) std::lround (std::clamp (t.l[i], -1.0f, 1.0f) * 32767.0f),
                       (short) std::lround (std::clamp (t.r[i], -1.0f, 1.0f) * 32767.0f) };
        std::fwrite (s, 2, 2, f);
    }
    std::fclose (f);
}

static float rms (const Take& t, double from, double to)
{
    double s = 0.0;
    const size_t a = (size_t) (from * kRate), b = std::min (t.l.size(), (size_t) (to * kRate));
    for (size_t i = a; i < b; ++i) s += 0.5 * (t.l[i] * t.l[i] + t.r[i] * t.r[i]);
    return (float) std::sqrt (s / std::max<size_t> (1, b - a));
}

int main()
{
    {
        touchgrass::GrassEngine e;
        e.prepare (kRate);
        e.setChord (0, touchgrass::GrassEngine::kMajor);
        const int want[13] = { 48, 52, 43, 60, 64, 55, 72, 76, 67, 84, 88, 79, 96 };
        bool same = e.stringCount() == 13;
        for (int i = 0; i < 13; ++i) same = same && e.stringMidi (i) == want[i];
        CHECK (same, "C major plate is the OM-84's order (C3 E3 G2 ... C7)");
        e.setChord (0, touchgrass::GrassEngine::kSeventh);
        CHECK (e.stringMidi (2) == 46, "C7 drops Bb2 where G2 was (got %d)", e.stringMidi (2));
        e.setChord (9, touchgrass::GrassEngine::kMinor);
        CHECK (e.stringMidi (0) == 45 && e.stringMidi (1) == 48, "A minor starts A2 C3 (got %d %d)", e.stringMidi (0), e.stringMidi (1));
    }

    const Take a = perform (512);
    const Take b = perform (64);

    float peak = 0.0f;
    bool finite = true;
    for (size_t i = 0; i < a.l.size(); ++i)
    {
        finite = finite && std::isfinite (a.l[i]) && std::isfinite (a.r[i]);
        peak = std::max (peak, std::max (std::abs (a.l[i]), std::abs (a.r[i])));
    }
    CHECK (finite, "output stays finite");
    CHECK (peak > 0.1f && peak < 1.0f, "peak %.3f is heard and below full scale", peak);

    const float silence = rms (a, 0.0, 0.15);
    const float sweep = rms (a, 0.3, 0.9);
    CHECK (sweep > 0.02f, "the sweep sounds (rms %.4f)", sweep);
    CHECK (silence < sweep * 0.6f, "before the first pluck only the drone swells (%.4f vs %.4f)", silence, sweep);

    // A sweep spread over 0.54 s: its loudness should rise over several windows,
    // not jump in one, as it would if every pluck landed at once.
    int rises = 0;
    float prev = rms (a, 0.15, 0.2);
    for (int k = 0; k < 10; ++k)
    {
        const float now = rms (a, 0.2 + k * 0.05, 0.25 + k * 0.05);
        if (now > prev * 1.02f) ++rises;
        prev = now;
    }
    CHECK (rises >= 4, "a spread sweep builds over time (%d rising windows)", rises);

    float maxDiff = 0.0f;
    for (size_t i = 0; i < a.l.size(); ++i)
        maxDiff = std::max (maxDiff, std::max (std::abs (a.l[i] - b.l[i]), std::abs (a.r[i] - b.r[i])));
    CHECK (maxDiff == 0.0f, "block size 512 and 64 render the same (max diff %g)", maxDiff);

    // The drone alone: no plucks, a chord, then another.
    {
        touchgrass::GrassEngine e;
        e.prepare (kRate);
        e.setDelay (0.0f, 0.0f, 72.0f);
        e.setChord (0, touchgrass::GrassEngine::kMajor);
        Take d; d.l.assign ((size_t) (kRate * 6), 0.0f); d.r = d.l;
        e.render (d.l.data(), d.r.data(), (int) (kRate * 3));
        e.setChord (7, touchgrass::GrassEngine::kMajor);
        e.render (d.l.data() + (size_t) (kRate * 3), d.r.data() + (size_t) (kRate * 3), (int) (kRate * 3));
        const float held = rms (d, 2.0, 3.0), across = rms (d, 3.0, 3.6), after = rms (d, 5.0, 6.0);
        CHECK (held > 0.005f, "the drone holds a chord (rms %.4f)", held);
        CHECK (across > held * 0.4f, "a chord change crossfades rather than dropping out (%.4f vs %.4f)", across, held);
        CHECK (after > held * 0.5f, "and settles on the new chord (rms %.4f)", after);
        e.setDroneLevel (0.0f);
        Take q; q.l.assign ((size_t) (kRate * 2), 0.0f); q.r = q.l;
        e.render (q.l.data(), q.r.data(), (int) (kRate * 2));
        CHECK (rms (q, 1.5, 2.0) < held * 0.05f, "drone level 0 fades it out (%.5f)", rms (q, 1.5, 2.0));
    }

    writeWav ("enginetest.wav", a);
    std::printf (failures ? "\n%d FAILED\n" : "\nall passed, listen to test/enginetest.wav\n", failures);
    return failures ? 1 : 0;
}
