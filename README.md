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

- 🎤 **Real-time pitch detection** using autocorrelation — no server, everything runs in your browser
- 🎹 **12 intervals** from minor 2nd to octave
- ⬆️⬇️ **Direction control** — ascending, descending, or both
- ⏱️ **Adjustable time limit** with slider (3–20 seconds)
- 🎯 **Visual pitch meter** — green = on target, yellow = close, red = way off
- 🎵 **Piano visualization** highlighting base note, target, and what you're singing
- 🔁 **Replay base note** mid-game with R key
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
