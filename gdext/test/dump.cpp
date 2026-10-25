// Renders a fixed score through GrassEngine to dump.f32 (interleaved stereo
// float, 48 kHz) for web/test/enginetest.mjs to compare the JavaScript port
// against. The score here and in the .mjs must stay the same.
//     cl /nologo /std:c++17 /O2 /EHsc dump.cpp && dump.exe

#define _CRT_SECURE_NO_WARNINGS
#include "../src/GrassEngine.h"

#include <cmath>
#include <cstdio>
#include <vector>

struct Ev { double at; int kind; int a; int b; };   // 0 pluck index, 1 chord, 2 pluck note

int main()
{
    const double rate = 48000.0;
    const int total = (int) (rate * 7.0), block = 128;
    std::vector<Ev> score;
    score.push_back ({ 0.0, 1, 0, 0 });
    for (int s = 0; s < 13; ++s) score.push_back ({ 0.25 + s * 0.05, 0, s, 0 });
    score.push_back ({ 2.0, 1, 5, 3 });
    for (int s = 12; s >= 0; --s) score.push_back ({ 2.2 + (12 - s) * 0.04, 0, s, 0 });
    const int am7[13] = { 45, 48, 43, 57, 60, 55, 69, 72, 67, 81, 84, 79, 93 };
    for (int s = 0; s < 13; ++s) score.push_back ({ 4.0 + s * 0.06, 2, am7[s], 0 });

    touchgrass::GrassEngine e;
    e.prepare (rate);
    std::vector<float> l ((size_t) total), r ((size_t) total);
    size_t next = 0;
    for (int pos = 0; pos < total; pos += block)
    {
        const int end = std::min (pos + block, total);
        int cursor = pos;
        while (next < score.size() && score[next].at * rate < end)
        {
            const auto& ev = score[next++];
            const int at = std::max (cursor, (int) std::lround (ev.at * rate));
            if (ev.kind == 0)      e.pluck (ev.a, 0.8f, at - cursor);
            else if (ev.kind == 2) e.pluckNote (ev.a, 0.8f, at - cursor);
            else
            {
                e.render (&l[(size_t) cursor], &r[(size_t) cursor], at - cursor);
                cursor = at;
                e.setChord (ev.a, ev.b);
            }
        }
        e.render (&l[(size_t) cursor], &r[(size_t) cursor], end - cursor);
    }
    FILE* f = std::fopen ("dump.f32", "wb");
    for (int i = 0; i < total; ++i) { std::fwrite (&l[(size_t) i], 4, 1, f); std::fwrite (&r[(size_t) i], 4, 1, f); }
    std::fclose (f);
    std::printf ("wrote dump.f32 (%d frames)\n", total);
    return 0;
}
