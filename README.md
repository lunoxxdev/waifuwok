# Satset Waifu - Real AI Super Resolution Extension

**Satset Waifu** is a premium, high-performance in-browser image upscaler and denoiser. It runs the authentic **Waifu2x (Swin-IR / CUNet)** neural network models locally in your browser using **ONNX Runtime Web** (WebAssembly multithreading).

## Key Features

- **Authentic AI Quality**: Runs real `swin_unet` and `cunet` models directly on WebAssembly CPU, giving you high-definition sharpening without color shifts.
- **Before/After Live Slider**: Drag the vertical divider left/right to compare the original and upscaled images.
- **Zoom & Pan Workspace**: Inspect fine details with mouse scroll wheel to zoom and drag to pan.
- **Clipboard Support**: Paste screenshots/images directly using `Ctrl + V` from Whatsapp, Windows Snipping Tool, etc.
- **Permanent Model Caching**: Automatically downloads weights on the first run and caches them using the Cache Storage API for instant, offline loading later.
- **Zero VRAM / Hardware Friendly**: Optimized to run using multithreaded CPU WebAssembly, making it fully compatible with legacy GPUs (like your AMD Radeon HD 6570!).

---

## How to Install as a Chrome Extension (Recommended)

1. Open **Google Chrome**.
2. Navigate to `chrome://extensions/` by typing it in the address bar.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click the **Load unpacked** button in the top-left corner.
5. Select the folder:
   `c:\Users\THE SAINS 1\Desktop\WAIFU`
6. Pin **Satset Waifu** to your extensions bar, and click the icon to open the full-screen dashboard!

---

## How to Run as a Local Web Server

If you prefer to run it as a regular web page instead of an extension:

1. Open PowerShell or Command Prompt in the project folder.
2. Run:
   ```bash
   node server.js
   ```
3. Open your browser and go to:
   `http://localhost:8080/`

---

## Technical Details

- **ONNX Runtime Web (v1.22.0)**: Uses the local SIMD + threaded WASM engine.
- **Cross-Origin Isolation**: Uses COOP (`same-origin`) and COEP (`require-corp`) headers to enable `SharedArrayBuffer` for maximum multithreading performance.
- **Model weights**: Sourced from the official `unlimited.waifu2x.net` CDNs and cached locally in the browser's Cache Storage.
