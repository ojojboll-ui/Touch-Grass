#pragma once

#include <array>
#include <string>

namespace chordtroller::music
{

/**
    The eight chords under the left thumb, and the strings they put under the
    right one.

    The ring is ordered by fifths with the tonic straight up, so rotating the
    thumb is a progression rather than eight memorised directions. Holding LB
    swaps the whole ring for its seventh-chord bank: the same eight directions
    with the same roots, coloured. There is only ever one layout to learn.
*/
enum class Quality
{
    major, minor, diminished,
    major7, dominant7, minor7, halfDiminished
};

struct Chord
{
    int     rootPitchClass = 0;                 // 0..11, C = 0
    Quality quality        = Quality::major;

    bool operator== (const Chord& o) const noexcept
    {
        return rootPitchClass == o.rootPitchClass && quality == o.quality;
    }

    bool operator!= (const Chord& o) const noexcept { return ! (*this == o); }
};

inline int chordThird (Quality q) noexcept
{
    switch (q)
    {
        case Quality::minor:
        case Quality::minor7:
        case Quality::diminished:
        case Quality::halfDiminished: return 3;
        default:                      return 4;
    }
}

/**
    The tone that gets dropped an octave on the plate.

    For a triad it is the fifth. For a seventh it is the seventh, and the fifth
    is not on the plate at all — which is exactly what jazz voicing does with the
    fifth when something has to go, and exactly what the OM-84 sample set shows.
*/
inline int chordColourTone (Quality q) noexcept
{
    switch (q)
    {
        case Quality::major:
        case Quality::minor:          return 7;
        case Quality::diminished:     return 6;
        case Quality::major7:         return 11;
        default:                      return 10;   // dominant7, minor7, halfDiminished
    }
}

inline const char* qualitySuffix (Quality q) noexcept
{
    switch (q)
    {
        case Quality::major:          return "";
        case Quality::minor:          return "m";
        case Quality::diminished:     return "dim";
        case Quality::major7:         return "maj7";
        case Quality::dominant7:      return "7";
        case Quality::minor7:         return "m7";
        case Quality::halfDiminished: return "m7b5";
    }

    return "";
}

inline const char* pitchClassName (int pc) noexcept
{
    // Flats rather than sharps: the ring runs anticlockwise into Bb and Eb long
    // before it reaches anything anyone would call A#.
    static const char* names[12] =
        { "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B" };

    return names[((pc % 12) + 12) % 12];
}

//==============================================================================

enum class Mode { major, minor };

class ChordRing
{
public:
    static constexpr int kSectors = 8;
    static constexpr int kBanks   = 2;
    static constexpr int kModes   = 2;

    int  keyRoot() const noexcept { return key; }
    void setKeyRoot (int pitchClass) noexcept { key = ((pitchClass % 12) + 12) % 12; }

    /** Parallel, not relative: C major becomes C minor rather than A minor. The
        relative would keep all eight chords and only move which one is home,
        which is elegant and reads on the ring as nothing having happened. */
    void setMode (Mode m) noexcept { mode = m; }
    void toggleMode() noexcept { mode = mode == Mode::major ? Mode::minor : Mode::major; }
    Mode currentMode() const noexcept { return mode; }
    bool isMinor() const noexcept { return mode == Mode::minor; }

    /** The d-pad moves the key in fifths, not semitones: neighbouring keys
        should be the ones that share almost all their chords, so a wrong press
        lands somewhere musical instead of a semitone off. */
    void transposeByFifths (int steps) noexcept { setKeyRoot (key + steps * 7); }

    /** Momentary rather than latching, because that is what the hand wants: LB
        held colours whatever the left thumb is already pointing at, and letting
        go puts it back. The original does the same thing with two chord buttons
        pressed together. */
    void setBank (int b) noexcept { bank = b > 0 ? 1 : 0; }
    int  currentBank() const noexcept { return bank; }

    Chord chordAt (int sector) const noexcept
    {
        const int s = ((sector % kSectors) + kSectors) % kSectors;
        const size_t m = mode == Mode::minor ? 1u : 0u;

        Chord c;
        c.rootPitchClass = (key + kDegrees[m][(size_t) s]) % 12;
        c.quality        = kQualities[m][(size_t) bank][(size_t) s];
        return c;
    }

    std::string nameAt (int sector) const
    {
        const auto c = chordAt (sector);
        return std::string (pitchClassName (c.rootPitchClass)) + qualitySuffix (c.quality);
    }

    std::string keyName() const
    {
        return std::string (pitchClassName (key)) + (mode == Mode::minor ? "-moll" : "-dur");
    }

    const char* bankName() const noexcept
    {
        return bank == 0 ? "A treklang" : "B septim";
    }

private:
    /**
        Both rings are chains of fifths with the tonic straight up, which is the
        whole reason the thumb can play a progression as an arc.

        Major, clockwise from the top: I V ii vi iii vii bVII IV.

        Minor, clockwise from the top: i V ii bII VI III VII iv. Two choices in
        there are worth defending. The fifth is **major**, not minor — the
        harmonic minor's V is what makes a minor key sound resolved rather than
        merely modal, and a minor v would have made every cadence limp. And the
        eighth slot is the Neapolitan, bII, which is where the fifths chain lands
        anyway and happens to be one of the best chords minor has.

        Either way V sits one step anticlockwise from home, so the cadence is the
        same hand movement in both modes.
    */
    static constexpr std::array<std::array<int, kSectors>, kModes> kDegrees
    {{
        { 0, 7, 2, 9, 4, 11, 10, 5 },
        { 0, 7, 2, 1, 8,  3, 10, 5 }
    }};

    static constexpr std::array<std::array<std::array<Quality, kSectors>, kBanks>, kModes> kQualities
    {{
        {{
            { Quality::major,   Quality::major,     Quality::minor,  Quality::minor,
              Quality::minor,   Quality::diminished, Quality::major, Quality::major },

            { Quality::major7,  Quality::dominant7, Quality::minor7, Quality::minor7,
              Quality::minor7,  Quality::halfDiminished, Quality::major7, Quality::major7 }
        }},
        {{
            { Quality::minor,   Quality::major,     Quality::diminished, Quality::major,
              Quality::major,   Quality::major,     Quality::major,      Quality::minor },

            { Quality::minor7,  Quality::dominant7, Quality::halfDiminished, Quality::major7,
              Quality::major7,  Quality::major7,    Quality::dominant7,      Quality::minor7 }
        }}
    }};

    int  key  = 0;
    int  bank = 0;
    Mode mode = Mode::major;
};

//==============================================================================

/**
    The plate, in the order the plate gives it.

    This is not a scale. Sweeping an Omnichord does not run up the chord tones in
    pitch order — each octave gives the root, the third, and then *drops a
    colour tone an octave below the root* before jumping up and doing it again.
    The sweep rolls instead of climbing, and that rolling is a large part of why
    the instrument sounds like a fingerpicked harp rather than a glissando.

    C major and C7, in plate order:

        C3  E3  G2  | C4  E4  G3  | C5  E5  G4  | C6  E6  G5  | C7
        48  52  43  | 60  64  55  | 72  76  67  | 84  88  79  | 96

        C3  E3  Bb2 | C4  E4  Bb3 | C5  E5  Bb4 | C6  E6  Bb5 | C7
        48  52  46  | 60  64  58  | 72  76  70  | 84  88  82  | 96

    Thirteen positions either way. The plate does not grow for a seventh — the
    colour tone takes the fifth's place and the fifth simply is not there, which
    is what a jazz voicing drops first and what the sample set shows.

    Reconstructed from the OM-84 sample set at github.com/benjamindehli/Omni-84,
    whose author states the notes are strummed in the original's order and offers
    plain ascending order as the alternative — which is how we know the original
    is not ascending.

    Two consequences worth knowing before changing anything here:

    The register follows the chord. Roots C to F start in octave 3, F# to B start
    in octave 2, which keeps every chord inside F#2..F7. That is why a
    progression moves up and down a little; it is the instrument, not a bug.

    F# is the one chord that ascends. Its root sits on the floor of the range, so
    there is no room to drop a colour tone below it and the tone goes above
    instead. The original does exactly this, and the rule below reproduces it by
    asking whether there is room rather than by special-casing F#.
*/
struct StringSet
{
    static constexpr int kFloorMidi  = 42;      // F#2, the lowest the plate reaches
    static constexpr int kOctaves    = 4;
    static constexpr int kMaxStrings = 16;

    int count = 0;
    std::array<int, kMaxStrings> midi {};       // in plate order, not pitch order

    void build (const Chord& chord) noexcept
    {
        const int pc     = ((chord.rootPitchClass % 12) + 12) % 12;
        const int third  = chordThird (chord.quality);
        const int colour = chordColourTone (chord.quality);

        // Low roots start in octave 3, high roots in octave 2, so no chord runs
        // off either end of the range.
        const int base = pc <= 5 ? 48 + pc : 36 + pc;

        // The colour tone drops an octave where there is room underneath, and
        // only where there is.
        const int colourOffset = (base + colour - 12) >= kFloorMidi ? colour - 12 : colour;

        count = 0;

        auto add = [this] (int note) noexcept
        {
            if (count < kMaxStrings)
                midi[(size_t) count++] = note;
        };

        for (int octave = 0; octave < kOctaves; ++octave)
        {
            const int root = base + 12 * octave;

            add (root);
            add (root + third);
            add (root + colourOffset);
        }

        add (base + 12 * kOctaves);
    }
};

} // namespace chordtroller::music
