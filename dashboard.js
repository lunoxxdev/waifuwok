// Satset Waifu - Core JavaScript Controller

// Configure ONNX Runtime Web
ort.env.wasm.proxy = true;
ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
ort.env.wasm.wasmPaths = {
  'ort-wasm-simd-threaded.wasm': 'dist/ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs': 'dist/ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.wasm': 'dist/ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs': 'dist/ort-wasm-simd-threaded.jsep.mjs',
  
  // Fallbacks for WASM
  'ort-wasm.wasm': 'dist/ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd.wasm': 'dist/ort-wasm-simd-threaded.wasm',
  'ort-wasm-threaded.wasm': 'dist/ort-wasm-simd-threaded.wasm',
  
  // Fallbacks for MJS
  'ort-wasm.mjs': 'dist/ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd.mjs': 'dist/ort-wasm-simd-threaded.mjs',
  'ort-wasm-threaded.mjs': 'dist/ort-wasm-simd-threaded.mjs',
  
  // Fallbacks for JSEP
  'ort-wasm-simd.jsep.wasm': 'dist/ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd.jsep.mjs': 'dist/ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm.jsep.wasm': 'dist/ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm.jsep.mjs': 'dist/ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-threaded.jsep.wasm': 'dist/ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-threaded.jsep.mjs': 'dist/ort-wasm-simd-threaded.jsep.mjs'
};

const BASE_MODEL_URL = window.location.protocol === 'chrome-extension:' 
  ? 'https://unlimited.waifu2x.net/' 
  : window.location.origin + '/';

// AI Architecture Configuration
function gen_arch_config() {
  const config = {};

  /* swin_unet */
  config["swin_unet"] = {
    art: { color_stability: true, padding: "replication" },
    art_scan: { color_stability: false, padding: "replication" },
    photo: { color_stability: false, padding: "reflection" }
  };
  
  const swin = config["swin_unet"];
  const calc_tile_size_swin_unet = function (tile_size, config) {
    while (true) {
      if ((tile_size - 16) % 12 == 0 && (tile_size - 16) % 16 == 0) {
        break;
      }
      tile_size += 1;
    }
    return tile_size;
  };
  
  for (const domain of ["art", "art_scan", "photo"]) {
    const base_config = {
      ...swin[domain],
      arch: "swin_unet",
      domain: domain,
      calc_tile_size: calc_tile_size_swin_unet
    };
    
    swin[domain] = {
      scale2x: { ...base_config, scale: 2, offset: 16 },
      scale4x: { ...base_config, scale: 4, offset: 32 },
      scale1x: { ...base_config, scale: 1, offset: 8 }, // bypass for alpha denoise
    };
    
    for (let i = 0; i < 4; ++i) {
      swin[domain]["noise" + i + "_scale2x"] = { ...base_config, scale: 2, offset: 16 };
      swin[domain]["noise" + i + "_scale4x"] = { ...base_config, scale: 4, offset: 32 };
      swin[domain]["noise" + i] = { ...base_config, scale: 1, offset: 8 };
    }
  }
  
  /* cunet */
  config["cunet"] = { art: {} };
  const calc_tile_size_cunet = function (tile_size, config) {
    const adj = config.scale == 1 ? 16 : 32;
    tile_size = ((tile_size * config.scale + config.offset * 2) - adj) / config.scale;
    tile_size -= tile_size % 4;
    return tile_size;
  };
  
  const base_config = {
    arch: "cunet",
    domain: "art",
    calc_tile_size: calc_tile_size_cunet,
    color_stability: true,
    padding: "replication",
  };
  
  config["cunet"]["art"] = {
    scale2x: { ...base_config, scale: 2, offset: 36 },
    scale1x: { ...base_config, scale: 1, offset: 28 }, // bypass for alpha denoise
  };
  
  const base = config["cunet"];
  for (let i = 0; i < 4; ++i) {
    base["art"]["noise" + i + "_scale2x"] = { ...base_config, scale: 2, offset: 36 };
    base["art"]["noise" + i] = { ...base_config, scale: 1, offset: 28 };
  }

  return config;
}

const CONFIG = {
  arch: gen_arch_config(),
  get_config: function (arch, style, method) {
    if ((arch in this.arch) && (style in this.arch[arch]) && (method in this.arch[arch][style])) {
      const config = { ...this.arch[arch][style][method] };
      config["path"] = `${BASE_MODEL_URL}models/${arch}/${style}/${method}.onnx`;
      return config;
    } else {
      return null;
    }
  },
  get_helper_model_path: function (name) {
    return `${BASE_MODEL_URL}models/utils/${name}.onnx`;
  }
};

// Cache Storage API for permanent offline model caching
async function loadModelWithCache(url, onProgress) {
  const cacheName = 'satset-waifu-models';
  const cache = await caches.open(cacheName);
  
  // Try matching from cache
  const cachedResponse = await cache.match(url);
  if (cachedResponse) {
    console.log(`Loading model from Cache Storage: ${url}`);
    return await cachedResponse.arrayBuffer();
  }
  
  console.log(`Downloading model: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download model file: ${response.statusText}`);
  }
  
  const contentLength = response.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;
  
  // Track download progress
  const reader = response.body.getReader();
  let received = 0;
  const chunks = [];
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0 && onProgress) {
      onProgress(received / total);
    }
  }
  
  // Reconstruct file
  const buffer = new Uint8Array(received);
  let position = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, position);
    position += chunk.length;
  }
  
  // Store copy in cache
  const cacheHeaders = new Headers({
    'Content-Type': 'application/octet-stream',
    'Content-Length': received.toString()
  });
  await cache.put(url, new Response(buffer.buffer, { headers: cacheHeaders }));
  
  return buffer.buffer;
}

// Inference Sessions cache manager
const onnx_session = {
  sessions: {},
  get_session: async function (onnx_path, onProgress) {
    if (!(onnx_path in this.sessions)) {
      try {
        const modelBuffer = await loadModelWithCache(onnx_path, onProgress);
        const uint8array = new Uint8Array(modelBuffer);
        
        let session = null;
        // Only run main AI models on GPU (Webgl). Helper models are tiny and faster on CPU WASM.
        const isHelperModel = onnx_path.includes('/utils/');
        
        if (!isHelperModel) {
          try {
            console.log(`Trying GPU WebGL session for: ${onnx_path}`);
            session = await ort.InferenceSession.create(
              uint8array,
              { executionProviders: ["webgl"] }
            );
            console.log("GPU WebGL loaded successfully!");
            activeEngine = 'WebGL GPU';
            updateEngineBadge();
          } catch (gpuError) {
            console.warn("GPU WebGL failed, falling back to CPU WebAssembly:", gpuError);
          }
        }
        
        if (!session) {
          console.log(`Loading CPU WebAssembly session for: ${onnx_path}`);
          session = await ort.InferenceSession.create(
            uint8array,
            { executionProviders: ["wasm"] }
          );
          console.log("CPU WebAssembly loaded successfully!");
          if (!isHelperModel) {
            activeEngine = 'WASM CPU';
            updateEngineBadge();
          }
        }
        
        this.sessions[onnx_path] = session;
      } catch (error) {
        console.error("ONNX Load Error:", error);
        throw error;
      }
    }
    return this.sessions[onnx_path];
  }
};

// SeamBlending Algorithm
const BLEND_SIZE = 16;
class SeamBlending {
  constructor(x_size, scale, offset, tile_size, blend_size = BLEND_SIZE) {
    this.x_size = x_size;
    this.scale = scale;
    this.offset = offset;
    this.tile_size = tile_size;
    this.blend_size = blend_size;
  }
  
  async build() {
    this.param = SeamBlending.calc_parameters(
      this.x_size, this.scale, this.offset, this.tile_size, this.blend_size
    );
    this.pixels = new ort.Tensor(
      'float32',
      new Float32Array(this.param.y_buffer_h * this.param.y_buffer_w * 3),
      [3, this.param.y_buffer_h, this.param.y_buffer_w]
    );
    this.weights = new ort.Tensor(
      'float32',
      new Float32Array(this.param.y_buffer_h * this.param.y_buffer_w * 3),
      [3, this.param.y_buffer_h, this.param.y_buffer_w]
    );
    this.blend_filter = await this.create_seam_blending_filter();
    this.output = new ort.Tensor(
      'float32',
      new Float32Array(this.blend_filter.data.length),
      this.blend_filter.dims
    );
  }
  
  update(x, tile_i, tile_j) {
    const step_size = this.param.output_tile_step;
    const [C, H, W] = this.blend_filter.dims;
    const HW = H * W;
    const buffer_h = this.pixels.dims[1];
    const buffer_w = this.pixels.dims[2];
    const buffer_hw = buffer_h * buffer_w;
    const h_i = step_size * tile_i;
    const w_i = step_size * tile_j;

    let old_weight, next_weight, new_weight;
    for (let c = 0; c < 3; ++c) {
      for (let i = 0; i < H; ++i) {
        for (let j = 0; j < W; ++j) {
          const tile_index = c * HW + i * W + j;
          const buffer_index = c * buffer_hw + (h_i + i) * buffer_w + (w_i + j);
          old_weight = this.weights.data[buffer_index];
          next_weight = old_weight + this.blend_filter.data[tile_index];
          old_weight = old_weight / next_weight;
          new_weight = 1.0 - old_weight;
          this.pixels.data[buffer_index] = (this.pixels.data[buffer_index] * old_weight +
                                            x.data[tile_index] * new_weight);
          this.weights.data[buffer_index] += this.blend_filter.data[tile_index];
          this.output.data[tile_index] = this.pixels.data[buffer_index];
        }
      }
    }
    return this.output;
  }
  
  get_rendering_config() {
    return this.param;
  }
  
  static calc_parameters(x_size, scale, offset, tile_size, blend_size) {
    const p = {};
    const x_h = x_size[2];
    const x_w = x_size[3];

    p.y_h = x_h * scale;
    p.y_w = x_w * scale;

    p.input_offset = Math.ceil(offset / scale);
    p.input_blend_size = Math.ceil(blend_size / scale);
    p.input_tile_step = tile_size - (p.input_offset * 2 + p.input_blend_size);
    p.output_tile_step = p.input_tile_step * scale;

    let h_blocks = 0, w_blocks = 0, input_h = 0, input_w = 0;
    while (input_h < x_h + p.input_offset * 2) {
      input_h = h_blocks * p.input_tile_step + tile_size;
      ++h_blocks;
    }
    while (input_w < x_w + p.input_offset * 2) {
      input_w = w_blocks * p.input_tile_step + tile_size;
      ++w_blocks;
    }
    p.h_blocks = h_blocks;
    p.w_blocks = w_blocks;
    p.y_buffer_h = input_h * scale;
    p.y_buffer_w = input_w * scale;
    p.pad = [
      p.input_offset,
      input_w - (x_w + p.input_offset),
      p.input_offset,
      input_h - (x_h + p.input_offset)
    ];
    return p;
  }
  
  async create_seam_blending_filter() {
    const ses = await onnx_session.get_session(CONFIG.get_helper_model_path("create_seam_blending_filter"));
    const scale = new ort.Tensor('int64', BigInt64Array.from([BigInt(this.scale)]), []);
    const offset = new ort.Tensor('int64', BigInt64Array.from([BigInt(this.offset)]), []);
    const tile_size = new ort.Tensor('int64', BigInt64Array.from([BigInt(this.tile_size)]), []);
    const out = await ses.run({
      "scale": scale,
      "offset": offset,
      "tile_size": tile_size,
    });
    return out.y;
  }
}

// Model inference engine runner
const onnx_runner = {
  stop_flag: false,
  running: false,
  
  to_input: function (rgba, width, height, keep_alpha = false) {
    if (keep_alpha) {
      const rgb = new Float32Array(height * width * 3);
      const alpha1 = new Float32Array(height * width * 1);
      const alpha3 = new Float32Array(height * width * 3);
      for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
          const i = (y * width * 4) + (x * 4);
          const j = (y * width + x);
          rgb[j] = rgba[i + 0] / 255.0;
          rgb[j + 1 * (height * width)] = rgba[i + 1] / 255.0;
          rgb[j + 2 * (height * width)] = rgba[i + 2] / 255.0;
          const alpha = rgba[i + 3] / 255.0;
          alpha1[j] = alpha;
          alpha3[j] = alpha;
          alpha3[j + 1 * (height * width)] = alpha;
          alpha3[j + 2 * (height * width)] = alpha;
        }
      }
      return [
        new ort.Tensor('float32', rgb, [1, 3, height, width]),
        new ort.Tensor('float32', alpha1, [1, 1, height, width]),
        new ort.Tensor('float32', alpha3, [1, 3, height, width])
      ];
    } else {
      const rgb = new Float32Array(height * width * 3);
      const bg_color = 1.0; // white background
      for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
          const alpha = rgba[(y * width * 4) + (x * 4) + 3] / 255.0;
          for (let c = 0; c < 3; ++c) {
            const i = (y * width * 4) + (x * 4) + c;
            const j = (y * width + x) + c * (height * width);
            rgb[j] = alpha * (rgba[i] / 255.0) + (1 - alpha) * bg_color;
          }
        }
      }
      return [new ort.Tensor('float32', rgb, [1, 3, height, width])];
    }
  },
  
  to_image_data: function (z, alpha3, width, height) {
    const rgba = new Uint8ClampedArray(height * width * 4);
    if (alpha3 != null) {
      for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
          let alpha_v = 0.0;
          for (let c = 0; c < 3; ++c) {
            const i = (y * width * 4) + (x * 4) + c;
            const j = (y * width + x) + c * (height * width);
            rgba[i] = (z[j] * 255.0) + 0.49999;
            alpha_v += alpha3[j] * (1.0 / 3.0);
          }
          rgba[(y * width * 4) + (x * 4) + 3] = (alpha_v * 255.0) + 0.49999;
        }
      }
    } else {
      rgba.fill(255);
      for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
          for (let c = 0; c < 3; ++c) {
            const i = (y * width * 4) + (x * 4) + c;
            const j = (y * width + x) + c * (height * width);
            rgba[i] = (z[j] * 255.0) + 0.49999;
          }
        }
      }
    }
    return new ImageData(rgba, width, height);
  },
  
  crop_tensor: function (bchw, x, y, width, height) {
    const [B, C, H, W] = bchw.dims;
    const ex = x + width;
    const ey = y + height;
    const roi = new Float32Array(B * C * height * width);
    let i = 0;
    for (let b = 0; b < B; ++b) {
      const bi = b * C * H * W;
      for (let c = 0; c < C; ++c) {
        const ci = bi + c * H * W;
        for (let h = y; h < ey; ++h) {
          const hi = ci + h * W;
          for (let w = x; w < ex; ++w) {
            roi[i++] = bchw.data[hi + w];
          }
        }
      }
    }
    return new ort.Tensor('float32', roi, [B, C, height, width]);
  },
  
  check_single_color: function (x, alpha3, keep_alpha = false) {
    const [B, C, H, W] = x.dims;
    let [r, g, b] = [x.data[0], x.data[1 * (H * W)], x.data[2 * (H * W)]];
    let a = 1.0;
    for (let bi = 0; bi < B; ++bi) {
      for (let h = 0; h < H; ++h) {
        for (let w = 0; w < W; ++w) {
          const i = bi * (C * H * W) + h * W + w;
          if (r != x.data[i + 0 * (H * W)] || 
              g != x.data[i + 1 * (H * W)] || 
              b != x.data[i + 2 * (H * W)]) {
            return null;
          }
        }
      }
    }
    if (alpha3 != null) {
      a = alpha3.data[0];
      const n = alpha3.dims[0] * alpha3.dims[1] * alpha3.dims[2] * alpha3.dims[3];
      for (let i = 0; i < n; ++i) {
        if (a != alpha3.data[i]) {
          return null;
        }
      }
    }
    if (keep_alpha) {
      return [r, g, b, a];
    } else {
      const bg_color = 1.0;
      r = a * r + (1 - a) * bg_color;
      g = a * g + (1 - a) * bg_color;
      b = a * b + (1 - a) * bg_color;
      return [r, g, b, 1.0];
    }
  },
  
  check_alpha_channel: function (rgba) {
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] != 255) return true;
    }
    return false;
  },
  
  create_single_color_tensor: function (rgba, size) {
    const rgb = new Float32Array(size * size * 3);
    const alpha3 = new Float32Array(size * size * 3);
    alpha3.fill(rgba[3]);
    for (let c = 0; c < 3; ++c) {
      const v = rgba[c];
      for (let i = 0; i < size * size; ++i) {
        rgb[c * size * size + i] = v;
      }
    }
    return [
      new ort.Tensor("float32", rgb, [1, 3, size, size]),
      new ort.Tensor("float32", alpha3, [1, 3, size, size])
    ];
  },
  
  shuffleArray: (array) => {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  },
  
  tiled_render: async function (
    image_data, config, alpha_config,
    tta_level, tile_size, tile_random,
    output_canvas, preview_canvas, block_callback
  ) {
    this.stop_flag = false;
    if (this.running) return;
    this.running = true;

    // Output setups
    const scale = config.scale;
    output_canvas.width = image_data.width * scale;
    output_canvas.height = image_data.height * scale;
    const output_ctx = output_canvas.getContext("2d", { willReadFrequently: true });

    // Live preview setups (same size so we can copy easily, but CSS scales it)
    preview_canvas.width = output_canvas.width;
    preview_canvas.height = output_canvas.height;
    const preview_ctx = preview_canvas.getContext("2d");
    
    // Draw initial scaled up blurry original to start
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = image_data.width;
    tempCanvas.height = image_data.height;
    tempCanvas.getContext('2d').putImageData(image_data, 0, 0);
    preview_ctx.imageSmoothingEnabled = false;
    preview_ctx.drawImage(tempCanvas, 0, 0, preview_canvas.width, preview_canvas.height);

    // Get models
    const has_alpha = alpha_config != null;
    const model = await onnx_session.get_session(config.path);
    let alpha_model = null;
    if (has_alpha) {
      alpha_model = await onnx_session.get_session(alpha_config.path);
    }

    // Preprocessing and padding
    let x = this.to_input(image_data.data, image_data.width, image_data.height, has_alpha);
    let alpha3;
    let seam_blending, seam_blending_alpha, p;

    if (has_alpha) {
      let alpha1;
      [rgb, alpha1, alpha3] = x;
      seam_blending = new SeamBlending(rgb.dims, scale, config.offset, tile_size);
      seam_blending_alpha = new SeamBlending(alpha3.dims, scale, config.offset, tile_size);
      await seam_blending_alpha.build();
      await seam_blending.build();

      p = seam_blending.get_rendering_config();
      x = await this.alpha_border_padding(rgb, alpha1, BigInt(config.offset));
      x = await this.padding(x, BigInt(p.pad[0]), BigInt(p.pad[1]), BigInt(p.pad[2]), BigInt(p.pad[3]), config.padding);
      alpha3 = await this.padding(alpha3, BigInt(p.pad[0]), BigInt(p.pad[1]), BigInt(p.pad[2]), BigInt(p.pad[3]), config.padding);
    } else {
      alpha3 = { data: null };
      x = x[0];
      seam_blending = new SeamBlending(x.dims, scale, config.offset, tile_size);
      await seam_blending.build();
      p = seam_blending.get_rendering_config();
      x = await this.padding(x, BigInt(p.pad[0]), BigInt(p.pad[1]), BigInt(p.pad[2]), BigInt(p.pad[3]), config.padding);
    }

    const all_blocks = p.h_blocks * p.w_blocks;
    const tiles = [];
    for (let h_i = 0; h_i < p.h_blocks; ++h_i) {
      for (let w_i = 0; w_i < p.w_blocks; ++w_i) {
        const i = h_i * p.input_tile_step;
        const j = w_i * p.input_tile_step;
        const ii = h_i * p.output_tile_step;
        const jj = w_i * p.output_tile_step;
        tiles.push([i, j, ii, jj, h_i, w_i]);
      }
    }
    
    if (tile_random) {
      this.shuffleArray(tiles);
    }

    block_callback(0, all_blocks, true);

    for (let k = 0; k < tiles.length; ++k) {
      if (this.stop_flag) {
        block_callback(k, all_blocks, false);
        this.running = false;
        return;
      }

      const [i, j, ii, jj, h_i, w_i] = tiles[k];
      let tile_x = this.crop_tensor(x, j, i, tile_size, tile_size);
      let tile_alpha3 = null;
      if (has_alpha) {
        tile_alpha3 = this.crop_tensor(alpha3, j, i, tile_size, tile_size);
      }

      const single_color = (config.color_stability ? 
                            this.check_single_color(tile_x, tile_alpha3, has_alpha) : null);
      
      let tile_y, tile_alpha_y;
      
      if (single_color == null) {
        if (has_alpha) {
          if (tta_level > 0) {
            tile_x = await this.tta_split(tile_x, BigInt(tta_level));
          }
          const output = await model.run({ x: tile_x });
          tile_y = output.y;
          if (tta_level > 0) {
            tile_y = await this.tta_merge(tile_y, BigInt(tta_level));
          }
          const alpha_output = await alpha_model.run({ x: tile_alpha3 });
          tile_alpha_y = alpha_output.y;
        } else {
          if (tta_level > 0) {
            tile_x = await this.tta_split(tile_x, BigInt(tta_level));
          }
          const tile_output = await model.run({ x: tile_x });
          tile_y = tile_output.y;
          if (tta_level > 0) {
            tile_y = await this.tta_merge(tile_y, BigInt(tta_level));
          }
        }
      } else {
        [tile_y, tile_alpha_y] = this.create_single_color_tensor(
          single_color, tile_size * scale - config.offset * 2
        );
      }

      let output_image_data;
      if (has_alpha) {
        const rgb_out = seam_blending.update(tile_y, h_i, w_i);
        const alpha_out = seam_blending_alpha.update(tile_alpha_y, h_i, w_i);
        output_image_data = this.to_image_data(rgb_out.data, alpha_out.data, tile_y.dims[3], tile_y.dims[2]);
      } else {
        const rgb_out = seam_blending.update(tile_y, h_i, w_i);
        output_image_data = this.to_image_data(rgb_out.data, null, tile_y.dims[3], tile_y.dims[2]);
      }

      // Draw onto both output canvas and preview canvas
      output_ctx.putImageData(output_image_data, jj, ii);
      preview_ctx.putImageData(output_image_data, jj, ii);

      block_callback(k + 1, all_blocks, true);
    }
    
    this.running = false;
  },

  padding: async function (x, left, right, top, bottom, mode) {
    const ses = await onnx_session.get_session(CONFIG.get_helper_model_path(mode + "_pad"));
    left = new ort.Tensor('int64', BigInt64Array.from([left]), []);
    right = new ort.Tensor('int64', BigInt64Array.from([right]), []);
    top = new ort.Tensor('int64', BigInt64Array.from([top]), []);
    bottom = new ort.Tensor('int64', BigInt64Array.from([bottom]), []);
    const out = await ses.run({
      "x": x,
      "left": left, "right": right,
      "top": top, "bottom": bottom
    });
    return out.y;
  },
  
  tta_split: async function (x, tta_level) {
    const ses = await onnx_session.get_session(CONFIG.get_helper_model_path("tta_split"));
    tta_level = new ort.Tensor('int64', BigInt64Array.from([tta_level]), []);
    const out = await ses.run({ "x": x, "tta_level": tta_level });
    return out.y;
  },
  
  tta_merge: async function (x, tta_level) {
    const ses = await onnx_session.get_session(CONFIG.get_helper_model_path("tta_merge"));
    tta_level = new ort.Tensor('int64', BigInt64Array.from([tta_level]), []);
    const out = await ses.run({ "x": x, "tta_level": tta_level });
    return out.y;
  },
  
  alpha_border_padding: async function (rgb, alpha, offset) {
    const ses = await onnx_session.get_session(CONFIG.get_helper_model_path("alpha_border_padding"));
    rgb = new ort.Tensor('float32', rgb.data, [rgb.dims[1], rgb.dims[2], rgb.dims[3]]);
    alpha = new ort.Tensor('float32', alpha.data, [alpha.dims[1], alpha.dims[2], alpha.dims[3]]);
    offset = new ort.Tensor('int64', BigInt64Array.from([offset]), []);
    const out = await ses.run({
      "rgb": rgb,
      "alpha": alpha,
      "offset": offset,
    });
    return new ort.Tensor("float32", out.y.data, [1, out.y.dims[0], out.y.dims[1], out.y.dims[2]]);
  }
};

function decode_image(image) {
  const [width, height] = [image.naturalWidth, image.naturalHeight];
  const canvas = new OffscreenCanvas(width, height);
  const gl = canvas.getContext("webgl");
  if (!gl) {
    // Fallback if WebGL isn't available
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  }
  gl.activeTexture(gl.TEXTURE0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

  const image_data = new ImageData(width, height);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, image_data.data);
  gl.deleteTexture(texture);
  gl.deleteFramebuffer(framebuffer);

  return image_data;
}

// Global state variables
let loadedImageFile = null;
let loadedImageElement = null;
let originalDataUrl = null;

// Radio Button Helpers
function getRadioValue(name) {
  const element = document.querySelector(`input[name="${name}"]:checked`);
  return element ? element.value : null;
}

function setRadioValue(name, value) {
  const element = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (element) {
    element.checked = true;
  }
}

// DOM Selectors
const selectTile = document.getElementById('select-tile');
const checkboxShuffle = document.getElementById('tile-shuffle');
const selectTta = document.getElementById('select-tta');
const selectAlpha = document.getElementById('select-alpha');

const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnUploadNew = document.getElementById('btn-upload-new');
const btnDownload = document.getElementById('btn-download');
const btnResetZoom = document.getElementById('btn-reset-zoom');

const statusText = document.getElementById('status-text');
const statusDot = document.querySelector('.status-dot');

const panelUpload = document.getElementById('panel-upload');
const panelProcessing = document.getElementById('panel-processing');
const panelResult = document.getElementById('panel-result');

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');

const progressFill = document.getElementById('progress-bar-fill');
const progressText = document.getElementById('progress-text');
const processingTitle = document.getElementById('processing-title');

const canvasPreview = document.getElementById('canvas-preview');
const canvasUpscaled = document.getElementById('canvas-upscaled');
const imgOriginal = document.getElementById('img-original');

const outputDimensions = document.getElementById('output-dimensions');
const processingTime = document.getElementById('processing-time');

const viewport = document.getElementById('viewport');
const panContainer = document.getElementById('pan-container');

// Settings management (localStorage)
function saveSettings() {
  localStorage.setItem('waifu_model', getRadioValue('model_style'));
  localStorage.setItem('waifu_noise_level', getRadioValue('noise_level'));
  localStorage.setItem('waifu_scale', getRadioValue('scale'));
  localStorage.setItem('waifu_tile_size', selectTile.value);
  localStorage.setItem('waifu_tile_random', checkboxShuffle.checked.toString());
  localStorage.setItem('waifu_tta', selectTta.value);
  localStorage.setItem('waifu_alpha', selectAlpha.value);
  localStorage.setItem('waifu_format', getRadioValue('format'));
}

function restoreSettings() {
  if (localStorage.getItem('waifu_model')) setRadioValue('model_style', localStorage.getItem('waifu_model'));
  if (localStorage.getItem('waifu_noise_level')) setRadioValue('noise_level', localStorage.getItem('waifu_noise_level'));
  if (localStorage.getItem('waifu_scale')) setRadioValue('scale', localStorage.getItem('waifu_scale'));
  if (localStorage.getItem('waifu_tile_size')) selectTile.value = localStorage.getItem('waifu_tile_size');
  if (localStorage.getItem('waifu_tile_random')) checkboxShuffle.checked = localStorage.getItem('waifu_tile_random') === 'true';
  if (localStorage.getItem('waifu_tta')) selectTta.value = localStorage.getItem('waifu_tta');
  if (localStorage.getItem('waifu_alpha')) selectAlpha.value = localStorage.getItem('waifu_alpha');
  if (localStorage.getItem('waifu_format')) setRadioValue('format', localStorage.getItem('waifu_format'));
  
  // Trigger UI limits checks
  handleModelChange();
}

function handleModelChange() {
  const modelValue = getRadioValue('model_style');
  if (!modelValue) return;
  const [arch, style] = modelValue.split('.');
  
  const scaleComment = document.getElementById('scale-comment');
  const scale4xContainer = document.getElementById('scale-4x-container');
  
  if (arch === 'swin_unet') {
    if (scale4xContainer) scale4xContainer.style.display = 'flex';
    if (scaleComment) scaleComment.style.display = 'none';
  } else {
    if (scale4xContainer) scale4xContainer.style.display = 'none';
    if (scaleComment) scaleComment.style.display = 'block';
    if (getRadioValue('scale') === '4') {
      setRadioValue('scale', '2');
    }
  }
}

// Bind UI event listeners
document.querySelectorAll('input[name="model_style"]').forEach(el => {
  el.addEventListener('change', () => { handleModelChange(); saveSettings(); });
});
document.querySelectorAll('input[name="noise_level"]').forEach(el => el.addEventListener('change', saveSettings));
document.querySelectorAll('input[name="scale"]').forEach(el => el.addEventListener('change', saveSettings));
document.querySelectorAll('input[name="format"]').forEach(el => el.addEventListener('change', saveSettings));

selectTile.addEventListener('change', saveSettings);
checkboxShuffle.addEventListener('change', saveSettings);
selectTta.addEventListener('change', saveSettings);
selectAlpha.addEventListener('change', saveSettings);

// Status managers
function setStatus(text, type = 'green') {
  statusText.textContent = text;
  statusDot.className = 'status-dot ' + type;
}

// Handle Panels Transition
function showPanel(panelName) {
  panelUpload.classList.remove('active');
  panelProcessing.classList.remove('active');
  panelResult.classList.remove('active');
  
  if (panelName === 'upload') {
    panelUpload.classList.add('active');
    setStatus('Ready to upscale', 'green');
    btnStart.disabled = false;
    btnStop.disabled = true;
  } else if (panelName === 'processing') {
    panelProcessing.classList.add('active');
    setStatus('AI Processing...', 'yellow');
    btnStart.disabled = true;
    btnStop.disabled = false;
  } else if (panelName === 'result') {
    panelResult.classList.add('active');
    setStatus('Processing complete!', 'blue');
    btnStart.disabled = false;
    btnStop.disabled = true;
  }
}

// Handle Image Loading
function loadImage(file) {
  if (!file || !file.type.match(/image.*/)) {
    alert("Please upload a valid image file!");
    return;
  }
  
  loadedImageFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    originalDataUrl = e.target.result;
    
    // Instantiate image element to get dimensions
    const img = new Image();
    img.onload = () => {
      loadedImageElement = img;
      imgOriginal.src = originalDataUrl;
      
      // Auto trigger start
      startProcessing();
    };
    img.src = originalDataUrl;
  };
  reader.readAsDataURL(file);
}

// Drag & drop handlers
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) {
    loadImage(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    loadImage(e.target.files[0]);
  }
});

// Clipboard paste handler (super useful for print shops)
document.addEventListener('paste', async (e) => {
  if (onnx_runner.running) return;
  
  const items = (e.clipboardData || e.originalEvent.clipboardData).items;
  for (const item of items) {
    if (item.type.indexOf("image") === 0) {
      const blob = item.getAsFile();
      loadImage(blob);
      break;
    }
  }
});

btnUploadNew.addEventListener('click', () => {
  loadedImageFile = null;
  loadedImageElement = null;
  originalDataUrl = null;
  fileInput.value = '';
  showPanel('upload');
});

// Start processing pipeline
async function startProcessing() {
  if (!loadedImageElement || onnx_runner.running) return;
  
  showPanel('processing');
  
  // Setup inputs
  const modelName = getRadioValue('model_style');
  const [arch, style] = modelName.split('.');
  const selectedScaleVal = getRadioValue('scale');
  const isScale16 = selectedScaleVal === '1.6';
  const scale = isScale16 ? 2 : parseInt(selectedScaleVal);
  const noiseLevel = parseInt(getRadioValue('noise_level'));
  
  let method = 'scale2x';
  if (scale === 1) {
    if (noiseLevel === -1) {
      alert("Please select a noise level when scaling is 1x!");
      showPanel('upload');
      return;
    }
    method = "noise" + noiseLevel;
  } else if (scale === 2) {
    method = noiseLevel === -1 ? "scale2x" : `noise${noiseLevel}_scale2x`;
  } else if (scale === 4) {
    method = noiseLevel === -1 ? "scale4x" : `noise${noiseLevel}_scale4x`;
  }
  
  const config = CONFIG.get_config(arch, style, method);
  if (!config) {
    alert("Selected model configuration not supported!");
    showPanel('upload');
    return;
  }
  
  const tileSize = config.calc_tile_size(parseInt(selectTile.value), config);
  const tileShuffle = checkboxShuffle.checked;
  const ttaLevel = parseInt(selectTta.value);
  const alphaEnabled = parseInt(selectAlpha.value) === 1;
  
  const imageData = decode_image(loadedImageElement);
  const hasAlpha = !alphaEnabled ? false : onnx_runner.check_alpha_channel(imageData.data);
  
  let alphaConfig = null;
  if (hasAlpha) {
    let alphaMethod = 'scale1x';
    if (method.includes("scale2x")) {
      alphaMethod = "scale2x";
    } else if (method.includes("scale4x")) {
      alphaMethod = "scale4x";
    }
    alphaConfig = CONFIG.get_config(arch, style, alphaMethod);
  }
  
  // Pre-load / download models with progress
  try {
    processingTitle.textContent = "Loading AI Networks...";
    progressFill.style.width = '0%';
    progressText.textContent = "Downloading model weights (approx 10-20MB)...";
    
    // Load main model
    await onnx_session.get_session(config.path, (pct) => {
      progressFill.style.width = `${pct * 50}%`;
      progressText.textContent = `Downloading main model: ${Math.round(pct * 100)}%`;
    });
    
    // Load alpha model if present
    if (hasAlpha) {
      progressText.textContent = "Downloading transparency model...";
      await onnx_session.get_session(alphaConfig.path, (pct) => {
        progressFill.style.width = `${50 + pct * 50}%`;
        progressText.textContent = `Downloading alpha model: ${Math.round(pct * 100)}%`;
      });
    }
    
    // Load helper models (all small, cached instantly)
    progressText.textContent = "Loading helper algorithms...";
    const helperModels = ["create_seam_blending_filter", "tta_split", "tta_merge", "alpha_border_padding"];
    if (config.padding === "replication" || (alphaConfig && alphaConfig.padding === "replication")) {
      helperModels.push("replication_pad");
    }
    if (config.padding === "reflection") {
      helperModels.push("reflection_pad");
    }
    
    for (let i = 0; i < helperModels.length; i++) {
      await onnx_session.get_session(CONFIG.get_helper_model_path(helperModels[i]));
    }
    
    // Start tiles rendering
    processingTitle.textContent = "Running AI Inference...";
    progressFill.style.width = '0%';
    progressText.textContent = "Processing image tiles...";
    
    const startTime = performance.now();
    
    await onnx_runner.tiled_render(
      imageData, config, alphaConfig,
      ttaLevel, tileSize, tileShuffle,
      canvasUpscaled, canvasPreview,
      (progress, max, processing) => {
        if (processing) {
          const pct = (progress / max) * 100;
          progressFill.style.width = `${pct}%`;
          progressText.textContent = `Rendering tiles: ${progress} / ${max} (${Math.round(pct)}%)`;
        } else {
          progressText.textContent = "Cancelled.";
        }
      }
    );
    
    const endTime = performance.now();
    
    if (onnx_runner.stop_flag) {
      showPanel('upload');
      return;
    }
    
    // Downscale from 2x to 1.6x if requested
    if (isScale16) {
      const w16 = Math.round(imageData.width * 1.6);
      const h16 = Math.round(imageData.height * 1.6);
      
      const scale16Canvas = document.createElement('canvas');
      scale16Canvas.width = w16;
      scale16Canvas.height = h16;
      const ctx16 = scale16Canvas.getContext('2d');
      ctx16.drawImage(canvasUpscaled, 0, 0, w16, h16);
      
      canvasUpscaled.width = w16;
      canvasUpscaled.height = h16;
      canvasUpscaled.getContext('2d').drawImage(scale16Canvas, 0, 0);
    }
    
    // Setup result viewport sizing
    const w = canvasUpscaled.width;
    const h = canvasUpscaled.height;
    panContainer.style.width = `${w}px`;
    panContainer.style.height = `${h}px`;
    
    outputDimensions.textContent = `${w}x${h} px`;
    processingTime.textContent = `${((endTime - startTime) / 1000).toFixed(1)}s`;
    
    // Set comparison layout
    showPanel('result');
    resetZoomAndCenter();
    
  } catch (err) {
    console.error(err);
    alert(`Error: ${err.message || err}`);
    showPanel('upload');
  }
}

btnStop.addEventListener('click', () => {
  onnx_runner.stop_flag = true;
});

// Download high res result
btnDownload.addEventListener('click', () => {
  if (!loadedImageFile) return;
  
  const format = getRadioValue('format') || 'png';
  const mimeType = format === 'webp' ? 'image/webp' : 'image/png';
  const ext = format === 'webp' ? 'webp' : 'png';
  
  canvasUpscaled.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    // Generate clean output filename
    const dotIdx = loadedImageFile.name.lastIndexOf('.');
    const baseName = dotIdx === -1 ? loadedImageFile.name : loadedImageFile.name.substring(0, dotIdx);
    const modelValue = getRadioValue('model_style') || 'swin_unet.art';
    const modelStr = modelValue.split('.')[0];
    const scaleStr = getRadioValue('scale') || '2';
    a.download = `${baseName}_satset_${modelStr}_${scaleStr}x.${ext}`;
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, mimeType);
});

// ZOOM & PAN CONTROLLER
let scale = 1;
let panX = 0;
let panY = 0;
let isDragging = false;
let startX = 0;
let startY = 0;

function updateTransform() {
  panContainer.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
}

function resetZoomAndCenter() {
  if (!canvasUpscaled.width) return;
  
  const w = canvasUpscaled.width;
  const h = canvasUpscaled.height;
  const viewRect = viewport.getBoundingClientRect();
  
  // Calculate best fit scale
  scale = Math.min(viewRect.width / w, viewRect.height / h, 1.0);
  
  // Center
  panX = (viewRect.width - w * scale) / 2;
  panY = (viewRect.height - h * scale) / 2;
  
  updateTransform();
}

btnResetZoom.addEventListener('click', resetZoomAndCenter);

viewport.addEventListener('mousedown', (e) => {
  // Prevent drag pan on slider handle
  if (e.target.id === 'slider-bar' || e.target.id === 'slider-handle') return;
  
  isDragging = true;
  startX = e.clientX - panX;
  startY = e.clientY - panY;
  panContainer.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', (e) => {
  if (isDragging) {
    panX = e.clientX - startX;
    panY = e.clientY - startY;
    updateTransform();
  }
});

window.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    panContainer.style.cursor = 'grab';
  }
});

// Zoom to mouse cursor position
viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomFactor = 1.15;
  const oldScale = scale;
  
  if (e.deltaY < 0) {
    scale = Math.min(scale * zoomFactor, 16);
  } else {
    scale = Math.max(scale / zoomFactor, 0.1);
  }
  
  const rect = viewport.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  // Pivot calculations
  panX = mouseX - (mouseX - panX) * (scale / oldScale);
  panY = mouseY - (mouseY - panY) * (scale / oldScale);
  
  updateTransform();
}, { passive: false });

// Double click to reset zoom
viewport.addEventListener('dblclick', (e) => {
  if (e.target.id === 'slider-bar' || e.target.id === 'slider-handle') return;
  resetZoomAndCenter();
});

// COMPARISON SLIDER DRAGGING
let isDraggingSlider = false;

function updateSlider(clientX) {
  const rect = panContainer.getBoundingClientRect();
  const x = clientX - rect.left;
  // Calculate percent location relative to container bounds
  const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
  panContainer.style.setProperty('--slider-pos', `${pct}%`);
}

viewport.addEventListener('mousedown', (e) => {
  if (e.target.id === 'slider-bar' || e.target.id === 'slider-handle') {
    isDraggingSlider = true;
    e.preventDefault();
  }
});

window.addEventListener('mousemove', (e) => {
  if (isDraggingSlider) {
    updateSlider(e.clientX);
  }
});

window.addEventListener('mouseup', () => {
  isDraggingSlider = false;
});

// Touch support for slider dragging
viewport.addEventListener('touchstart', (e) => {
  if (e.target.id === 'slider-bar' || e.target.id === 'slider-handle') {
    isDraggingSlider = true;
  }
}, { passive: true });

window.addEventListener('touchmove', (e) => {
  if (isDraggingSlider && e.touches.length > 0) {
    updateSlider(e.touches[0].clientX);
  }
}, { passive: true });

window.addEventListener('touchend', () => {
  isDraggingSlider = false;
});

let activeEngine = 'detecting';

function updateEngineBadge() {
  const badge = document.getElementById('engine-badge');
  if (!badge) return;
  
  if (activeEngine === 'detecting') {
    const isIsolated = window.crossOriginIsolated;
    const threads = navigator.hardwareConcurrency || 4;
    if (isIsolated) {
      badge.textContent = `💻 WASM CPU (${threads} Threads)`;
      badge.style.color = 'var(--text-sub)';
      badge.style.borderColor = 'var(--border-color)';
    } else {
      badge.textContent = `⚠️ WASM CPU (Single-threaded - Slow)`;
      badge.style.color = '#f59e0b';
      badge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
    }
  } else if (activeEngine === 'WebGL GPU') {
    badge.textContent = `🚀 GPU WebGL Accelerated`;
    badge.style.color = '#06b6d4';
    badge.style.borderColor = 'rgba(6, 182, 212, 0.4)';
    badge.style.boxShadow = '0 0 8px rgba(6, 182, 212, 0.2)';
  } else if (activeEngine === 'WASM CPU') {
    const threads = navigator.hardwareConcurrency || 4;
    const isIsolated = window.crossOriginIsolated;
    if (isIsolated) {
      badge.textContent = `💻 WASM CPU (${threads} Threads)`;
      badge.style.color = 'var(--accent)';
      badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    } else {
      badge.textContent = `⚠️ WASM CPU (Single-threaded - Slow)`;
      badge.style.color = '#f59e0b';
      badge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
    }
  }
}

// Restore settings on load
restoreSettings();
updateEngineBadge();
showPanel('upload');
