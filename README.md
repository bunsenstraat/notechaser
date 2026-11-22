# 🎵 NoteChaser

**Flappy Bird meets ear training.** Play a note, sing the interval, chain your streak. How far can you go?

<p align="center">
  <img src="https://img.shields.io/badge/Zero_Dependencies-0a0a0f?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Single_File-0a0a0f?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Web_Audio_API-0a0a0f?style=for-the-badge&logo=google-chrome&logoColor=00f0ff" />
</p>

<p align="center">
  <b><a href="https://bunsenstraat.github.io/notechaser/">▶ Play Now</a></b>
</p>

---

## What is this?

NoteChaser is a browser-based interval training game that uses your microphone to detect your singing pitch in real-time. The game plays you a base note, asks you to sing a specific musical interval up or down, and if you nail it — that note becomes your new base. Chain intervals together and see how long you can survive.

Think of it as Flappy Bird, but instead of tapping, you're singing.

## How to play

1. **Select your intervals** — pick which ones you want to practice from the grid
2. **Choose direction** — up, down, or both
3. **Set your time limit** — 3 to 20 seconds per note
4. **Hit Start** and sing!

Hold the correct pitch (within ±50 cents) for half a second to lock it in. The progress bar fills up as you hold — green means you've got it.

**Press R** during gameplay to replay the base note (use headphones!).

## Features

- 🎤 **Real-time pitch detection** using autocorrelation — no server, everything runs in your browser. It runs in a background worker fed by an AudioWorklet, so listening never competes with the UI or the piano sound (older browsers fall back to the main thread)
- 🎹 **12 intervals** from minor 2nd to octave
- ⬆️⬇️ **Direction control** — ascending, descending, or both
- ⏱️ **Adjustable time limit** with slider (3–20 seconds)
- 🎯 **Visual pitch meter** — green = on target, yellow = close, red = way off
- 🎵 **Piano visualization** highlighting base note, target, and what you're singing
- 🎹 **Your own SoundFont** — load an `.sf2` piano (Settings → Piano Sound) and every note uses it: velocity layers, stereo samples, loops, envelopes. Read in the page and kept in this browser's storage — never uploaded
- 🎛️ **MIDI out** — send every note to an external synth or DAW (Settings → MIDI Out; Chrome/Edge). Sample-accurate timing; MIDI keyboard input and MIDI out are never on together, so the app can't hear its own notes
- 🎧 **Chord Identify** — hear a chord, name it from the chord types you selected (no mic needed; keys 1–9 answer). Types that sound identical with a random root (e.g. Major 2nd and Min7 RL-A) all count as correct. Answer by **type**, by **position** only (A/B/C, with the quality shown), or by **quality** only (positions mixed)
- 🎧 **Progressions by ear** (Find the Bass → Exercise) — besides singing the roots, *name the progression* (ii-V-I, turnaround, backdoor, tritone sub…), *name the roots* chord by chord in Roman numerals, or *name the positions* (A/B) as the progression plays. Voiced like a pianist: positions switch A↔B on every move by a 4th, and the whole progression is planned so it never leaps an octave halfway through
- 🎹 **Collapsible playable keyboard** at the bottom of the exercise screen — tap to hear notes (multi-touch, glissando), and in MIDI input mode it doubles as an on-screen MIDI keyboard
- 🔁 **Replay base note** mid-game with R key
- ⏭ **Wait before the next question** (Settings) — in Chord Identify and the progression exercises, stay on the revealed answer (SPACE replays it) until you press ENTER or tap Next, instead of moving on by itself
- ⏸ **ENTER pauses/resumes listening** any time — and with "Wait for ENTER before listening" on, every assignment waits for you instead of auto-starting while you're still singing the last one
- 📱 **Mobile friendly** — works on phone browsers with mic access
- 🏆 **Streak counter** — compete with yourself

## Difficulty Guide

| Level | Setup | You'll feel... |
|-------|-------|---------------|
| 🟢 **Beginner** | Perfect 4th + 5th, Up only, 15s | Confident |
| 🟡 **Intermediate** | Add Major/Minor 3rds, Both directions, 10s | Challenged |
| 🟠 **Advanced** | Add 2nds + 6ths, 7s | Sweaty |
| 🔴 **Masochist** | All intervals + tritone, 5s | Pain |

### Presets

| Preset | Intervals |
|--------|-----------|
| Easy | Major 2nd, Minor 3rd, Perfect 4th, Perfect 5th |
| Triads | Minor 3rd, Major 3rd, Perfect 4th, Perfect 5th |
| All | All 12 intervals (you brave soul) |

## Tech

Single `index.html` file. No build step. No dependencies. No excuses.

- **Web Audio API** for note synthesis and microphone input
- Piano tone rendered once per octave into an `AudioBuffer` (additive partials with string inharmonicity + hammer transient), replayed with `playbackRate` — no samples to download
- Melodies, licks and cadences are scheduled on the audio clock, not `setTimeout`, so rhythm survives a busy main thread
- **Autocorrelation pitch detection** with parabolic interpolation
- Adaptive FFT size for high sample rate devices (mobile)
- Optimized for **male vocal range** (C3–E4)
- Deployed via **GitHub Pages**

## Tips

- 🎧 **Use headphones** to prevent speaker feedback into pitch detection
- Start with **Easy** preset and long time limit to build confidence
- Watch the pitch meter — it tells you if you're sharp or flat
- Minor 2nd and Major 7th are brutal. Tritone is evil. You've been warned.

## Run locally

```
# That's it. Just open it.
open index.html
```

Needs microphone permission and a modern browser with Web Audio API support.

## License

MIT
