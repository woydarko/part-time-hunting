# One-Shot and Procedural SFX

For sounds that aren't tied to a node you already control — an impact at a raycast hit point, a UI click, a pickup chime — use `GlobalAudioManager` instead of building a `SoundNode`. Source: `.engine/src/utils/GlobalAudioManager.ts`.

## Getting the manager

Source: `.engine/src/utils/GlobalAudioManager.ts` (`getInstance`), `.engine/src/game/World.ts` (`globalAudioManager`) — typechecked against 18.1.0-alpha.317
```typescript
const audio = this.getWorld()?.globalAudioManager; // bound to the current world
// or, equivalently, the singleton itself:
const same = ENGINE.GlobalAudioManager.getInstance();
```

Both return the same instance — the world calls `setWorld(this)` on it during startup and `setWorld(null)` on teardown, which is what wires it to the current `AudioListener`/`AudioContext` and resets its buses between play sessions.

## Playing

Source: `.engine/src/utils/GlobalAudioManager.ts` (`playSoundAtPosition`, `playGlobalSound`) — typechecked against 18.1.0-alpha.317
```typescript
// Positional — snapshots `position` once; does not track a moving emitter.
const handle = await audio.playSoundAtPosition('@project/assets/audio/impact.wav', hitPoint, {
  volume: 0.8,
  maxDistance: 20,
  bus: 'SFX',
});

// Non-positional — same volume everywhere.
const musicHandle = await audio.playGlobalSound('@project/assets/audio/theme.wav', {
  loop: true,
  bus: 'Music',
});
```

`GlobalSoundOptions`: `volume`, `loop`, `maxDistance`, `distanceModel`, `rolloffFactor`, `bus` (defaults to `'SFX'`), and the playback rules below. Both calls resolve to a `SoundHandle` (`{ id, audioUrl, isPositional }`) or `null` if there was no audio listener yet, the buffer failed to load, or a rule skipped the play.

Each call creates a brand-new `THREE.Audio`/`PositionalAudio` object — there is no pooling. That's what makes this the right tool for many simultaneous overlapping one-shots (unlike `SoundNode.play()`, which only ever has one "current" sound).

## Pitch and limits

| Option | Default | Effect |
| --- | --- | --- |
| `playbackRate` | `1` | Speed and pitch: 2 is an octave up and twice as fast, 0.5 an octave down |
| `pitchVariation` | `0` | Each play shifts the pitch by up to ± this many semitones, drawn from `world.presentationRandom` (a seeded replay repeats them; gameplay draws from `world.random` are not shifted) |
| `maxVoices` | unlimited | Copies of this file playing at once; a new play stops the oldest |
| `minInterval` | `0` | Real seconds after the last play of this file during which a play is skipped (`null`) |

`audio.maxSounds` (32) caps one-shots playing at once across all files: past it a new one-shot resolves `null` and adds to `audio.droppedSoundCount`, which resets when the next world binds. A one-shot dropped this way stops nothing, not even an older copy its `maxVoices` would have replaced. Looping sounds are not counted. Every limit counts sounds still loading, so a burst of calls in one frame is limited in call order, and a sound stopped while loading never starts.

`playSoundAtPositionSync` / `playGlobalSoundSync` are just aliases for the async methods (still return a `Promise`) — kept for call-site convenience, not a synchronous fast path.

## Stopping and cleanup

- Non-looping one-shots clean themselves up when the clip ends. The manager installs that cleanup before `play()`.
- Looping one-shots do not clean themselves up. Keep the returned `SoundHandle` and call `audio.stopSound(handle)` yourself, or it plays forever (and leaks the underlying `AudioBufferSourceNode`/`PositionalAudio`).
- `audio.stopAllSounds()` stops and cleans up everything tracked by the manager — useful on a scene/level transition. `world.destroy()`/end-play already calls this for you.
- `audio.isSoundPlaying(handle)`, `getPlayingSoundCount()`, `getPlayingSounds()` for introspection. `getPlayingSoundCount()` drops when a one-shot ends; `liveSoundCount` also counts one-shots still loading.

## Preloading

`await audio.loadSound(key, url)` warms the `resourceManager` cache ahead of time (`key` is only used for logging — the cache itself is keyed by URL). `isSoundLoaded(url)` / `getLoadedSounds()` check cache state. `unloadSound(url)` drops that clip's cached buffer; `unloadAllSounds()` stops every sound and drops all cached sound buffers, not other resources.

## Footgun: position is a snapshot, not tracking

`playSoundAtPosition` places a one-shot `PositionalAudio` at a fixed point and adds it directly to the world root — it does not parent to, or follow, any node. If a sound needs to move with something (a projectile whizzing past, an NPC's footsteps), attach a `SoundNode` to that node instead.
