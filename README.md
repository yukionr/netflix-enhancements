# Netflix Enhancements

A directly installable userscript for Netflix: blurred side backgrounds, video
zoom, keyboard shortcuts, wheel volume, playback statistics, and player tab titles.

![Netflix playback with blurred backgrounds filling the side margins](docs/images/blurred-background-preview.webp)

## Installation

Use a userscript manager such as Violentmonkey. Open
[`src/script.user.js`](src/script.user.js), select **Raw** on GitHub, and confirm
installation in the manager. Reload Netflix after installing or updating.
The source needs no build step or runtime dependencies.

When updating the former Netflix Blurred Bars script, replace its existing
source instead of running a second copy. The script name is **Netflix
Enhancements**; the namespace remains `local.netflix-blurred-bars` for update
identity. Disable other scripts or extensions that provide the same shortcuts
or wheel controls.

## Background ON/OFF

Open the userscript manager's menu on Netflix and choose:

- **Turn Netflix background ON**: display the blurred side backgrounds.
- **Turn Netflix background OFF**: remove the backgrounds immediately.

Both commands save the choice across page reloads. Repeating a command keeps
that state. Other enhancements remain available while the background is off.
Reload other open Netflix tabs to apply the saved choice there. To disable all
features, disable the script in the manager and reload Netflix.

## Settings and shortcuts

Open **Netflix Enhancements settings** in Violentmonkey's script menu to edit the
JSON settings below. Every value is a boolean. Cancel or invalid input leaves
settings unchanged. Changes apply immediately and persist across reloads; reload
other open Netflix tabs to apply them there.

| Setting | Default | Behavior |
| --- | --- | --- |
| `blurredBars` | `true` | Fill supported side margins with the blurred background |
| `ultrawide` | `true` | Enable the `.` shortcut for the 21:9 crop preset |
| `zoom` | `true` | Enable manual video zoom |
| `keyboard` | `true` | Enable the script's keyboard shortcuts |
| `volumeWheel` | `true` | Adjust volume with the wheel over the player |
| `statistics` | `false` | Display presented FPS, source resolution and dropped frames |
| `tabTitle` | `true` | Use the visible player title as the tab title |

| Key | Action |
| --- | --- |
| `.` | Apply 131.25% zoom, cropping 16:9 video for a 21:9 display |
| `+` or `=` / `-` | Zoom in / out in 5 percentage-point steps (100–400%) |
| `,` | Reset to the original video scale |
| `q` | Toggle statistics and save that preference |
| `d` / `e` or `Esc` | Lock / release the pointer, subject to browser permission |
| `h` | Show shortcut help |

Shortcuts ignore text inputs, editable content, IME composition and Ctrl/Alt/Meta
combinations. The wheel raises or lowers volume by 5 percentage points and
unmutes on increase. It leaves scrolling outside the player and Ctrl+wheel alone.
Zoom applies scaling after Netflix's positioning transform, keeping its visual
center fixed during zoom, resize and fullscreen changes. It affects the video only;
subtitles remain at their original size. The 21:9 preset is a fixed crop, not
automatic detection of encoded black bars. Zoom and blur can be enabled together;
blur only paints the supported side margins left after zooming.
Because the background uses the browser's top layer, it is temporarily hidden
while Netflix's player controls are visible, then returns after they fade out.
Visibility checks include ancestor opacity and respond to control style changes.

Zoom follows replacement video elements within the tab and restores their inline
styles on reset, feature disable or playback exit. It resets on page reload.
Statistics use presented-frame counts divided by actual elapsed time, so paused
video approaches 0 FPS; this is not the media's nominal frame rate. Source
resolution comes from `videoWidth` / `videoHeight`; unavailable frame-count APIs
show **FPS unavailable**. Player title changes depend on Netflix's current
`data-uia="video-title"` markup. The previous tab title is restored only if the
script still owns it.

## Browser support and limitations

The background supports centered videos with side margins on Netflix `/watch/`
pages. It does not fill top/bottom margins or detect bars encoded in the video.
The Popover API is required. Firefox attempts a CSS `-moz-element()` mirror;
other browsers attempt low-resolution Canvas frame copies at up to 10 Hz.
Netflix DRM can block either method or produce black frames. The script does
not bypass DRM or modify playback protection. Fullscreening the video element
alone cannot show sibling backgrounds; player fullscreen is supported.

The script makes no network requests and stores feature settings, never video
frames. **Netflix blurred bars diagnostics (v1.2.0)** reports geometry, renderer,
and frame-copy availability without URLs, page text, account data, or frames.
The metadata icon references a Netflix-hosted icon, which the userscript manager
may retrieve.

## Development

Node.js and npm are needed only for local checks. No dependency install is needed.

```console
npm test
npm run check
git diff --check
```

Tests in `test/` use Node's built-in runner and simulated browser objects. They
cover settings persistence, explicit ON/OFF commands, layout, lifecycle cleanup,
renderer failures, zoom, shortcuts, volume, statistics, and titles. These checks
do not establish real Netflix DRM rendering, subtitle layering, or live manager
integration; verify those in the target browser separately.
