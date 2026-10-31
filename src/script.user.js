// ==UserScript==
// @name         Netflix Enhancements
// @namespace    local.netflix-blurred-bars
// @version      1.2.1
// @description  Configurable blurred bars, ultrawide zoom, shortcuts, wheel volume, video statistics and tab titles for Netflix.
// @icon         https://assets.nflxext.com/us/ffe/siteui/common/icons/nficon2016.ico
// @match        https://www.netflix.com/watch/*
// @run-at       document-idle
// @noframes
// @grant        GM_registerMenuCommand
// @grant        GM_log
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
    'use strict';

    if (typeof GM_log === 'function' && typeof document !== 'undefined') {
        GM_log(JSON.stringify({ version: '1.2.1', event: 'started' }));
    }

    // Return player-relative side margins and the size of a centered cover image.
    function layout(player, video, sourceWidth, sourceHeight, fit, snapshot = video) {
        if (![player.width, player.height, video.width, video.height, sourceWidth, sourceHeight]
            .every((value) => Number.isFinite(value) && value > 0)) return null;
        let width = video.width;
        let height = video.height;
        if (fit === 'contain' || fit === 'scale-down') {
            let scale = Math.min(width / sourceWidth, height / sourceHeight);
            if (fit === 'scale-down') scale = Math.min(scale, 1);
            width = sourceWidth * scale;
            height = sourceHeight * scale;
        } else if (fit !== 'cover' && fit !== 'fill') {
            return null;
        }
        const left = video.left - player.left + (video.width - width) / 2;
        const top = video.top - player.top + (video.height - height) / 2;
        const right = left + width;
        // Do not paint over the picture or try to infer black bars encoded in it.
        if (left < 2 || right > player.width - 2 || top > 2 || top + height < player.height - 2) return null;
        const scale = Math.max(player.width / width, player.height / height);
        return { width: player.width, height: player.height, left, right,
            backgroundWidth: snapshot.width * scale, backgroundHeight: snapshot.height * scale };
    }

    const defaults = Object.freeze({
        blurredBars: true, ultrawide: true, zoom: true, keyboard: true,
        volumeWheel: true, statistics: false, tabTitle: true
    });

    function validSettings(value) {
        return value && typeof value === 'object' && !Array.isArray(value) &&
            Object.keys(value).every((key) => Object.hasOwn(defaults, key) && typeof value[key] === 'boolean');
    }

    function createEnhancements({ document, location, settings, save, getComputedStyle, now, alert }) {
        let video = null;
        let player = null;
        let zoom = 1;
        let zoomMode = '';
        let originalTransform = null;
        let statistics = null;
        let sample = null;
        let previousTitle = null;
        let writtenTitle = null;

        function restoreTitle() {
            if (writtenTitle !== null && document.title === writtenTitle) document.title = previousTitle;
            previousTitle = writtenTitle = null;
        }

        function restoreTransform() {
            if (!video || !originalTransform) return;
            for (const [key, value, priority] of originalTransform) {
                if (value) video.style.setProperty(key, value, priority);
                else video.style.removeProperty(key);
            }
            originalTransform = null;
        }

        function applyZoom() {
            if (!video) return;
            // Re-read the page's transform at its original size after resize or
            // fullscreen changes. Individual CSS scale would also scale Netflix's
            // centering translation, moving the picture away from the player center.
            restoreTransform();
            if (zoom === 1) return;
            const transform = getComputedStyle(video).transform;
            originalTransform = ['transform', 'transform-origin'].map((key) =>
                [key, video.style.getPropertyValue(key), video.style.getPropertyPriority(key)]);
            video.style.setProperty('transform', `${transform && transform !== 'none' ? `${transform} ` : ''}scale(${zoom})`, 'important');
            video.style.setProperty('transform-origin', 'center', 'important');
        }

        function removeStatistics() {
            statistics?.remove();
            statistics = sample = null;
        }

        function detach() {
            restoreTransform();
            removeStatistics();
            if (video && document.pointerLockElement === video) document.exitPointerLock();
            video = player = null;
        }

        function stop() {
            detach();
            restoreTitle();
        }

        function updateStatistics() {
            if (!settings.statistics) { removeStatistics(); return; }
            if (!statistics || !statistics.isConnected) {
                statistics = document.createElement('div');
                statistics.setAttribute('data-netflix-enhancements-stats', '');
                Object.assign(statistics.style, {
                    position: 'absolute', top: '16px', left: '16px', zIndex: '2147483647',
                    pointerEvents: 'none', padding: '6px 10px', borderRadius: '4px',
                    background: 'rgba(0, 0, 0, 0.8)', color: '#fff',
                    font: '14px/1.5 monospace', whiteSpace: 'pre-wrap', maxWidth: '90%'
                });
                player.append(statistics);
                sample = null;
            }
            const time = now();
            const quality = video.getVideoPlaybackQuality?.();
            if (sample && time - sample.time < 1000) return;
            const fps = quality && sample && quality.totalVideoFrames >= sample.frames ?
                `${((quality.totalVideoFrames - sample.frames) * 1000 / (time - sample.time)).toFixed(1)} FPS` :
                quality ? 'FPS measuring…' : 'FPS unavailable';
            statistics.textContent = `${fps} | ${video.videoWidth} × ${video.videoHeight}` +
                (quality ? ` | Dropped: ${quality.droppedVideoFrames}` : '');
            sample = { time, frames: quality?.totalVideoFrames };
        }

        function update() {
            if (!/^\/watch\/\d+/.test(location.pathname) || document.hidden) { stop(); return; }
            const current = [...document.querySelectorAll('video')].filter((node) => {
                const style = getComputedStyle(node);
                return node.isConnected && node.readyState >= 2 && !node.ended &&
                    style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            }).sort((a, b) => {
                const ar = a.getBoundingClientRect();
                const br = b.getBoundingClientRect();
                return br.width * br.height - ar.width * ar.height;
            })[0];
            const container = current && (current.closest('.watch-video--player-view') ||
                current.closest('.watch-video') || current.parentElement);
            if (current !== video || container !== player) {
                detach();
                video = current || null;
                player = container || null;
            }
            if (!video || !player) return;
            if ((zoomMode === 'ultrawide' && !settings.ultrawide) || (zoomMode === 'zoom' && !settings.zoom)) {
                zoom = 1;
                zoomMode = '';
            }
            applyZoom();
            updateStatistics();
            if (!settings.tabTitle) { restoreTitle(); return; }
            const titleNode = document.querySelector('[data-uia="video-title"]');
            const title = titleNode && [...titleNode.childNodes].map((node) =>
                (node.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
            if (title && document.title !== title) {
                if (previousTitle === null) previousTitle = document.title;
                document.title = writtenTitle = title;
            }
        }

        function typing(target) {
            return target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) ||
                Boolean(target?.closest?.('[contenteditable=""], [contenteditable="true"], [role="textbox"]'));
        }
        function ignore(event) {
            return event.isTrusted !== true || event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
                event.ctrlKey || event.altKey || event.metaKey || typing(event.target);
        }

        document.addEventListener('keydown', (event) => {
            if (!settings.keyboard || ignore(event)) return;
            update();
            if (!video || !player) return;
            const key = event.key;
            if (['+', '=', '-'].includes(key) && settings.zoom) {
                zoom = Math.round(Math.min(4, Math.max(1, zoom + (key === '-' ? -0.05 : 0.05))) * 10000) / 10000;
                zoomMode = 'zoom';
                applyZoom();
            } else if (key === '.' && settings.ultrawide) {
                zoom = 21 / 16;
                zoomMode = 'ultrawide';
                applyZoom();
            } else if (key === ',' && (settings.zoom || settings.ultrawide)) {
                zoom = 1;
                zoomMode = '';
                applyZoom();
            } else if (key === 'q') {
                settings.statistics = !settings.statistics;
                save();
                updateStatistics();
            } else if (key === 'd' && video.requestPointerLock) {
                try {
                    // Some browsers return void instead of a Promise.
                    video.requestPointerLock()?.catch(() => {});
                } catch { /* Keep playback usable if the browser rejects pointer lock. */ }
            } else if ((key === 'e' || key === 'Escape') && document.pointerLockElement === video) {
                document.exitPointerLock();
            } else if (key === 'h') {
                alert('Netflix Enhancements\n. 21:9 crop\n+ / = Zoom in\n- Zoom out\n, Reset zoom\nq Toggle FPS / resolution\nd Lock pointer\ne / Esc Release pointer\nWheel: volume\nUse the script menu to configure features.');
            } else return;
            event.preventDefault();
        });
        document.addEventListener('wheel', (event) => {
            if (!settings.volumeWheel || ignore(event) || !event.deltaY) return;
            update();
            if (!video || !player || !player.contains(event.target)) return;
            const delta = event.deltaY < 0 ? 0.05 : -0.05;
            video.volume = Math.min(1, Math.max(0, Math.round((video.volume + delta) * 100) / 100));
            if (delta > 0) video.muted = false;
            event.preventDefault();
        }, { passive: false });
        return { update, stop };
    }

    if (typeof module !== 'undefined') module.exports = { layout, createEnhancements, validSettings };
    if (typeof document === 'undefined') return;

    const version = '1.2.1';
    const stored = GM_getValue('settings', {});
    const settings = { ...defaults, ...(validSettings(stored) ? stored : {}) };
    const imageId = 'local-netflix-blurred-bars-video';
    const mirror = typeof document.mozSetImageElement === 'function' &&
        typeof CSS !== 'undefined' && CSS.supports('background-image', `-moz-element(#${imageId})`);
    let enabled = settings.blurredBars;
    let active = null;
    let rejectedVideo = null;
    let lastFrame = '';
    let timer = null;
    let status = 'starting';
    let loggedGeometry = '';
    let frameCopy = 'untested';
    const enhancements = createEnhancements({ document, location, settings,
        save: () => GM_setValue('settings', { ...settings }),
        getComputedStyle, now: () => performance.now(), alert: (message) => alert(message) });

    function clear() {
        if (!active) return;
        if (active.frameCallback !== undefined) {
            active.video.cancelVideoFrameCallback(active.frameCallback);
        }
        active.root.remove();
        if (mirror) document.mozSetImageElement(imageId, null);
        active = null;
        lastFrame = '';
        loggedGeometry = '';
    }

    function create(video, player, snapshot) {
        const root = document.createElement('netflix-blurred-bars');
        root.popover = 'manual';
        root.setAttribute('data-netflix-blurred-bars', '');
        root.setAttribute('data-version', version);
        root.setAttribute('aria-hidden', 'true');
        Object.assign(root.style, {
            all: 'initial', position: 'fixed', inset: 'auto', margin: '0',
            padding: '0', border: '0', background: 'transparent',
            pointerEvents: 'none', overflow: 'hidden'
        });
        const shadow = root.attachShadow({ mode: 'open' });
        const panels = [0, 1].map(() => {
            const clip = document.createElement('div');
            Object.assign(clip.style, {
                position: 'absolute', top: '0', height: '100%', overflow: 'hidden', pointerEvents: 'none'
            });
            const picture = document.createElement(mirror ? 'div' : 'canvas');
            Object.assign(picture.style, {
                position: 'absolute', top: '0', pointerEvents: 'none',
                filter: 'blur(32px) brightness(0.55)', transform: 'scale(1.08)',
                backgroundRepeat: 'no-repeat', backgroundPosition: 'center', backgroundSize: 'cover'
            });
            if (mirror) picture.style.backgroundImage = `-moz-element(#${imageId})`;
            clip.append(picture);
            shadow.append(clip);
            return { clip, picture, context: mirror ? null : picture.getContext('2d') };
        });
        const styles = document.createElement('style');
        styles.textContent = ':host::backdrop { background: transparent; pointer-events: none; }';
        shadow.append(styles);
        if (!mirror && panels.some((panel) => !panel.context)) return;
        if (mirror) document.mozSetImageElement(imageId, snapshot);
        // The top layer uses viewport coordinates even inside transformed players.
        // A shadow tree prevents page CSS from resizing the background panels.
        document.documentElement.prepend(root);
        root.showPopover();
        active = { video, player, snapshot, root, panels, refreshedFrames: 0 };
        if (mirror && typeof video.requestVideoFrameCallback === 'function' &&
            typeof video.cancelVideoFrameCallback === 'function') {
            const state = active;
            const refresh = () => {
                if (active !== state) return;
                // Firefox ignores an unchanged image target; rebind within this
                // callback so the next paint uses the frame just presented.
                document.mozSetImageElement(imageId, null);
                document.mozSetImageElement(imageId, state.snapshot);
                state.refreshedFrames += 1;
                if (state.refreshedFrames === 60) {
                    GM_log(JSON.stringify({ version, event: 'frame-sync', refreshedFrames: 60 }));
                }
                state.frameCallback = video.requestVideoFrameCallback(refresh);
            };
            state.frameCallback = video.requestVideoFrameCallback(refresh);
        }
    }

    function updateControlVisibility() {
        if (!active) return;
        const controls = document.querySelectorAll('.watch-video--bottom-controls-container, .watch-video--top-controls-container, [data-uia="control-play-pause"], [data-uia="control-back-to-browse"]');
        const visible = [...controls].some((control) => {
            if (![...control.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0)) return false;
            for (let node = control; node; node = node.parentElement) {
                const style = getComputedStyle(node);
                if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
            }
            return true;
        });
        // Top-layer popovers paint above all page z-index values. Keep their
        // pixels out of the way while Netflix shows controls, including fades.
        const visibility = visible ? 'hidden' : 'visible';
        if (active.root.style.visibility !== visibility) active.root.style.visibility = visibility;
    }

    function updateBackground() {
        if (!enabled || document.hidden || !/^\/watch\/\d+/.test(location.pathname)) {
            status = !enabled ? 'disabled' : document.hidden ? 'hidden' : 'not-playback-page';
            clear();
            return;
        }
        // Re-select after Netflix replaces the player during in-page navigation.
        const candidates = [...document.querySelectorAll('video')].filter((video) => {
            const style = getComputedStyle(video);
            return video.isConnected && video.readyState >= 2 && !video.ended &&
                style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        });
        const video = candidates.sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            return br.width * br.height - ar.width * ar.height;
        })[0];
        if (!video || video === rejectedVideo) {
            status = video ? 'frame-copy-unavailable' : 'no-ready-video';
            clear();
            return;
        }
        const fullscreen = document.fullscreenElement;
        const player = fullscreen && fullscreen !== video && fullscreen.contains(video) ? fullscreen :
            video.closest('.watch-video--player-view') || video.closest('.watch-video') || video.parentElement;
        // An element fullscreened by itself cannot display sibling backgrounds.
        if (!player || fullscreen === video) { status = 'no-player-container'; clear(); return; }
        const playerRect = player.getBoundingClientRect();
        const videoRect = video.getBoundingClientRect();
        const snapshot = video.parentElement || video;
        const style = getComputedStyle(video);
        const centered = ['50% 50%', 'center center', 'center'].includes(style.objectPosition);
        const geometry = centered && layout(playerRect, videoRect, video.videoWidth, video.videoHeight, style.objectFit, mirror ? snapshot.getBoundingClientRect() : videoRect);
        if (!geometry) { status = 'no-supported-side-margins'; clear(); return; }
        if (active && (active.video !== video || active.player !== player || active.snapshot !== snapshot || !active.root.isConnected)) clear();
        if (!active) create(video, player, snapshot);
        if (!active) return;
        updateControlVisibility();
        status = 'active';
        Object.assign(active.root.style, {
            left: `${playerRect.left}px`, top: `${playerRect.top}px`,
            width: `${geometry.width}px`, height: `${geometry.height}px`
        });
        active.panels.forEach(({ clip, picture }, index) => {
            const offset = index ? geometry.right : 0;
            clip.style.left = `${offset}px`;
            const width = index ? geometry.width - geometry.right : geometry.left;
            clip.style.width = `${width}px`;
            picture.style.left = '0px';
            picture.style.width = `${width}px`;
            picture.style.height = `${geometry.height}px`;
            if (mirror) {
                picture.style.backgroundSize = `${geometry.backgroundWidth}px ${geometry.backgroundHeight}px`;
                picture.style.backgroundPosition = `${(geometry.width - geometry.backgroundWidth) / 2 - offset}px ${(geometry.height - geometry.backgroundHeight) / 2}px`;
            }
        });
        const frame = [video.currentTime, video.videoWidth, video.videoHeight, geometry.width, geometry.height].join(':');
        if (mirror || lastFrame === frame) return;
        try {
            const scale = Math.max(geometry.width / video.videoWidth, geometry.height / video.videoHeight);
            const width = geometry.width / scale;
            const height = geometry.height / scale;
            for (let index = 0; index < active.panels.length; index += 1) {
                const { picture, context } = active.panels[index];
                const offset = index ? geometry.right : 0;
                const panelWidth = index ? geometry.width - geometry.right : geometry.left;
                const targetWidth = Math.min(160, Math.round(panelWidth));
                const targetHeight = Math.max(1, Math.round(targetWidth * geometry.height / panelWidth));
                if (picture.width !== targetWidth) picture.width = targetWidth;
                if (picture.height !== targetHeight) picture.height = targetHeight;
                context.drawImage(video, (video.videoWidth - width) / 2 + offset / scale,
                    (video.videoHeight - height) / 2, panelWidth / scale, height, 0, 0, targetWidth, targetHeight);
            }
            lastFrame = frame;
        } catch {
            // Some CDMs reject frame copies. Leave playback untouched and stop retrying this element.
            rejectedVideo = video;
            status = 'frame-copy-unavailable';
            clear();
            console.warn('Netflix Blurred Bars: frame copying is unavailable (possibly protected media). Background disabled for this video.');
        }
    }

    function update() {
        try {
            enhancements.update();
            updateBackground();
        } finally {
            logGeometry();
        }
    }

    function setBackground(value) {
        enabled = value;
        settings.blurredBars = enabled;
        GM_setValue('settings', { ...settings });
        rejectedVideo = null;
        if (!enabled) clear();
        else update();
    }
    GM_registerMenuCommand('Turn Netflix background ON', () => setBackground(true));
    GM_registerMenuCommand('Turn Netflix background OFF', () => setBackground(false));
    GM_registerMenuCommand('Netflix Enhancements settings', () => {
        const answer = prompt('Netflix Enhancements: set each feature to true or false. Changes apply to this tab immediately; reload other tabs to apply them.', JSON.stringify(settings, null, 2));
        if (answer === null) return;
        let value;
        try { value = JSON.parse(answer); } catch { alert('Invalid JSON. Settings were not changed.'); return; }
        if (!validSettings(value)) { alert('Use known setting names with true or false values. Settings were not changed.'); return; }
        Object.assign(settings, value);
        GM_setValue('settings', { ...settings });
        enabled = settings.blurredBars;
        rejectedVideo = null;
        update();
    });
    function diagnostics() {
        function bounds(element) {
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        }
        function describe(element) {
            if (!element) return null;
            const style = getComputedStyle(element);
            return { rect: bounds(element), transform: style.transform,
                zoom: style.zoom, overflow: style.overflow, position: style.position };
        }
        const report = {
            version, renderer: mirror ? 'firefox-css' : 'canvas', status, enabled, frameCopy,
            frameSync: active?.frameCallback !== undefined ? 'video-frame-callback' : mirror ? 'automatic' : 'timer',
            refreshedFrames: active?.refreshedFrames || 0,
            viewport: { width: window.innerWidth, height: window.innerHeight,
                scale: window.visualViewport?.scale, pixelRatio: window.devicePixelRatio },
            fullscreen: Boolean(document.fullscreenElement),
            videos: [...document.querySelectorAll('video')].slice(0, 4).map((video) => {
                const style = getComputedStyle(video);
                return {
                    source: { width: video.videoWidth, height: video.videoHeight },
                    rect: bounds(video), readyState: video.readyState,
                    objectFit: style.objectFit, objectPosition: style.objectPosition,
                    player: describe(video.closest('.watch-video--player-view')),
                    canvas: describe(video.closest('[data-uia="video-canvas"]')),
                    parent: describe(video.parentElement),
                    geometry: layout((active?.video === video ? active.player :
                        video.closest('.watch-video--player-view') || video.parentElement).getBoundingClientRect(),
                    video.getBoundingClientRect(), video.videoWidth, video.videoHeight, style.objectFit, mirror ? (video.parentElement || video).getBoundingClientRect() : video.getBoundingClientRect())
                };
            }),
            overlays: [...document.querySelectorAll('[data-netflix-blurred-bars]')].map((root) => ({
                version: root.getAttribute('data-version'), rect: bounds(root),
                panels: root.shadowRoot ? [...root.shadowRoot.children]
                    .filter((child) => child.tagName === 'DIV').map((clip) => ({
                        rect: bounds(clip), picture: bounds(clip.children[0])
                    })) : null
            }))
        };
        return report;
    }
    GM_registerMenuCommand(`Netflix blurred bars diagnostics (v${version})`, () => {
        // Collect geometry only: no URLs, account state, page text, or video frames.
        prompt(`Netflix Enhancements v${version}: copy diagnostics`, JSON.stringify(diagnostics(), null, 2));
    });
    function logGeometry() {
        const rect = active?.player.getBoundingClientRect();
        const key = active ? [status, rect.left, rect.top, rect.width, rect.height,
            active.video.videoWidth, active.video.videoHeight].join(':') : status;
        if (loggedGeometry === key) return;
        loggedGeometry = key;
        if (active) try {
            const probe = document.createElement('canvas');
            probe.width = 16;
            probe.height = 9;
            const context = probe.getContext('2d');
            context.drawImage(active.video, 0, 0, 16, 9);
            const pixels = context.getImageData(0, 0, 16, 9).data;
            frameCopy = pixels.some((value, index) => index % 4 !== 3 && value > 8) ? 'available' : 'empty';
        } catch {
            frameCopy = 'blocked';
        }
        GM_log(JSON.stringify(diagnostics()));
    }
    // A 10 Hz low-resolution fallback avoids a full-size per-frame Canvas copy.
    function start() {
        if (timer !== null) return;
        timer = setInterval(update, 100);
        update();
    }
    const observer = new MutationObserver(() => {
        if (active && (!active.video.isConnected || !active.root.isConnected)) clear();
        updateControlVisibility();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true,
        attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    document.addEventListener('fullscreenchange', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
    window.addEventListener('pagehide', () => {
        clearInterval(timer);
        timer = null;
        clear();
        enhancements.stop();
    });
    window.addEventListener('pageshow', start);
    start();
})();
