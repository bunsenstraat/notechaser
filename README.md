# 🎵 NoteChaser

**Flappy Bird meets ear training.** Play a note, sing the interval, chain your streak. How far can you go?

🎮 **[Play Now](https://bunsenstraat.github.io/notechaser/)**

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

## Features

- **12 intervals** from minor 2nd to octave
- **Real-time pitch detection** using autocorrelation — no server, everything runs in your browser
- **Visual pitch meter** showing how close you are (green = on target, yellow = close, red = way off)
- **Piano visualization** highlighting base note, target, and what you're singing
- **Adjustable time limit** with a slider (3–20 seconds)
- **Presets** — Easy, Triads, All, or build your own set
- **High score tracking** saved locally
- **Male vocal range** optimized (C3–E4)
- **Mobile friendly** — works on phone browsers with mic access

## Presets

| Preset | Intervals |
|--------|-----------|
| Easy | Major 2nd, Minor 3rd, Perfect 4th, Perfect 5th |
| Triads | Minor 3rd, Major 3rd, Perfect 4th, Perfect 5th |
| All | All 12 intervals |

## Tech

Single `index.html` file. No build step. No dependencies.

- **Web Audio API** for note synthesis and microphone input
- **Autocorrelation pitch detection** with parabolic interpolation
- Adaptive FFT size for high sample rate devices (mobile)
- Deployed via **GitHub Pages**

## Tips

- Use headphones to prevent the played note from feeding back into pitch detection
- Start with **Easy** preset and long time limit to get comfortable
- The pitch meter is your friend — watch the needle and adjust
- Minor 2nd and Major 7th are brutal. You've been warned.

## Run locally

Just open `index.html` in a browser. That's it. Needs microphone permission and a modern browser with Web Audio API support.

## License

MIT
