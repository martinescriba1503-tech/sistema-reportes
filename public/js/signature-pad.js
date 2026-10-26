/**
 * Smooth Signature Pad for Field Tablets, Touch Screens and Desktops
 * Handles touch, stylus with pressure, and mouse with High-DPI support
 */
class DigitalSignaturePad {
  constructor(canvasElement, placeholderElement, onChange = null) {
    this.canvas = canvasElement;
    this.placeholder = placeholderElement;
    this.onChange = onChange;
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;

    this.isDrawing = false;
    this.hasDrawn = false;
    this.strokes = []; // Normalized stroke paths: [ [{x, y}, ...], ... ]
    this.currentStroke = null;
    this.loadedImage = null; // Stored image when loaded from base64 dataUrl

    this.lastWidth = 0;
    this.lastHeight = 0;
    this.lastPos = null;

    if (this.canvas && this.ctx) {
      this.initCanvas();
      this.attachEvents();
    }
  }

  initCanvas() {
    this.resize();
  }

  resize() {
    if (!this.canvas || !this.ctx) return;

    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = Math.round(rect.width);
    const cssHeight = Math.round(rect.height);

    // If the canvas container is currently hidden (e.g. display: none in stepper)
    if (cssWidth <= 0 || cssHeight <= 0) {
      if (this.canvas.width === 0) {
        this.canvas.width = 360;
        this.canvas.height = 180;
      }
      return;
    }

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const newWidth = Math.round(cssWidth * ratio);
    const newHeight = Math.round(cssHeight * ratio);

    // If dimensions haven't changed, keep existing canvas buffer
    if (this.canvas.width === newWidth && this.canvas.height === newHeight && this.lastWidth === cssWidth) {
      return;
    }

    this.canvas.width = newWidth;
    this.canvas.height = newHeight;
    this.lastWidth = cssWidth;
    this.lastHeight = cssHeight;

    // Scale drawing context so standard CSS coordinates match buffer pixels
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.applyContextStyles();
    this.redraw();
  }

  applyContextStyles() {
    if (!this.ctx) return;
    this.ctx.strokeStyle = '#031240';
    this.ctx.fillStyle = '#031240';
    this.ctx.lineWidth = 2.5;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  }

  redraw() {
    if (!this.ctx) return;

    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || this.lastWidth || 360;
    const h = rect.height || this.lastHeight || 180;

    this.ctx.clearRect(0, 0, w, h);
    this.applyContextStyles();

    // 1. Draw loaded bitmap if existing and no user strokes
    if (this.loadedImage && (!this.strokes || this.strokes.length === 0)) {
      const imgW = this.loadedImage.naturalWidth || this.loadedImage.width || w;
      const imgH = this.loadedImage.naturalHeight || this.loadedImage.height || h;
      const imgAspect = imgW / imgH;
      const boxAspect = w / h;

      let drawW = w - 16;
      let drawH = h - 16;
      if (imgAspect > boxAspect) {
        drawH = drawW / imgAspect;
      } else {
        drawW = drawH * imgAspect;
      }
      const drawX = (w - drawW) / 2;
      const drawY = (h - drawH) / 2;
      try {
        this.ctx.drawImage(this.loadedImage, drawX, drawY, drawW, drawH);
      } catch (err) {
        console.warn('Error re-dibujando imagen de firma:', err);
      }
    }

    // 2. Draw vector strokes
    if (this.strokes && this.strokes.length > 0) {
      for (const stroke of this.strokes) {
        if (!stroke || stroke.length === 0) continue;
        if (stroke.length === 1) {
          // Tap / Dot
          const pt = stroke[0];
          this.ctx.beginPath();
          this.ctx.arc(pt.x * w, pt.y * h, this.ctx.lineWidth / 2, 0, Math.PI * 2);
          this.ctx.fill();
        } else {
          this.ctx.beginPath();
          this.ctx.moveTo(stroke[0].x * w, stroke[0].y * h);
          for (let i = 1; i < stroke.length; i++) {
            const p0 = stroke[i - 1];
            const p1 = stroke[i];
            const midX = ((p0.x + p1.x) / 2) * w;
            const midY = ((p0.y + p1.y) / 2) * h;
            this.ctx.quadraticCurveTo(p0.x * w, p0.y * h, midX, midY);
          }
          const last = stroke[stroke.length - 1];
          this.ctx.lineTo(last.x * w, last.y * h);
          this.ctx.stroke();
        }
      }
    }

    this.updatePlaceholder();
  }

  getPointerPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    let clientX = e.clientX;
    let clientY = e.clientY;

    if (clientX === undefined && e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if (clientX === undefined && e.changedTouches && e.changedTouches.length > 0) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    }

    const w = rect.width || this.lastWidth || 360;
    const h = rect.height || this.lastHeight || 180;
    return {
      x: Math.max(0, Math.min(w, (clientX || 0) - rect.left)),
      y: Math.max(0, Math.min(h, (clientY || 0) - rect.top)),
      width: w,
      height: h
    };
  }

  attachEvents() {
    // Auto-resize observer when canvas container becomes visible or resizes
    if (window.ResizeObserver) {
      const target = this.canvas.parentElement || this.canvas;
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const cr = entry.contentRect;
          if (cr.width > 0 && cr.height > 0) {
            this.resize();
          }
        }
      });
      this.resizeObserver.observe(target);
    }

    window.addEventListener('resize', () => {
      this.resize();
    });

    const startDraw = (e) => {
      if (e.button !== undefined && e.button !== 0) return; // Only primary button
      e.preventDefault();

      // Ensure buffer size matches visible layout
      this.resize();

      this.isDrawing = true;
      this.hasDrawn = true;
      if (this.placeholder) this.placeholder.style.display = 'none';

      const pos = this.getPointerPos(e);
      const normPt = { x: pos.x / pos.width, y: pos.y / pos.height };
      this.currentStroke = [normPt];
      this.strokes.push(this.currentStroke);

      // Render dot for immediate feedback and tap-dots
      this.applyContextStyles();
      this.ctx.beginPath();
      this.ctx.arc(pos.x, pos.y, this.ctx.lineWidth / 2, 0, Math.PI * 2);
      this.ctx.fill();

      this.lastPos = pos;

      if (e.pointerId && this.canvas.setPointerCapture) {
        try {
          this.canvas.setPointerCapture(e.pointerId);
        } catch (err) {}
      }
    };

    const moveDraw = (e) => {
      if (!this.isDrawing || !this.currentStroke) return;
      e.preventDefault();

      const pos = this.getPointerPos(e);
      const normPt = { x: pos.x / pos.width, y: pos.y / pos.height };
      this.currentStroke.push(normPt);

      // Draw smooth line segment using quadratic bezier
      this.applyContextStyles();
      this.ctx.beginPath();
      this.ctx.moveTo(this.lastPos.x, this.lastPos.y);
      const midX = (this.lastPos.x + pos.x) / 2;
      const midY = (this.lastPos.y + pos.y) / 2;
      this.ctx.quadraticCurveTo(this.lastPos.x, this.lastPos.y, midX, midY);
      this.ctx.lineTo(pos.x, pos.y);
      this.ctx.stroke();

      this.lastPos = pos;
    };

    const stopDraw = (e) => {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      this.lastPos = null;

      if (e && e.pointerId && this.canvas.releasePointerCapture) {
        try {
          this.canvas.releasePointerCapture(e.pointerId);
        } catch (err) {}
      }

      this.updatePlaceholder();
      if (typeof this.onChange === 'function') {
        this.onChange(this.toDataURL());
      }
    };

    // Modern pointer events (covers stylus, touch, mouse with high precision)
    if (window.PointerEvent) {
      this.canvas.addEventListener('pointerdown', startDraw);
      this.canvas.addEventListener('pointermove', moveDraw);
      this.canvas.addEventListener('pointerup', stopDraw);
      this.canvas.addEventListener('pointercancel', stopDraw);
    } else {
      // Fallback for legacy browsers
      this.canvas.addEventListener('mousedown', startDraw);
      window.addEventListener('mousemove', moveDraw);
      window.addEventListener('mouseup', stopDraw);

      this.canvas.addEventListener('touchstart', startDraw, { passive: false });
      window.addEventListener('touchmove', moveDraw, { passive: false });
      window.addEventListener('touchend', stopDraw);
      window.addEventListener('touchcancel', stopDraw);
    }
  }

  updatePlaceholder() {
    if (this.placeholder) {
      this.placeholder.style.display = this.isEmpty() ? 'block' : 'none';
    }
  }

  clear() {
    this.strokes = [];
    this.loadedImage = null;
    this.hasDrawn = false;
    this.currentStroke = null;
    this.lastPos = null;

    if (this.ctx) {
      const rect = this.canvas.getBoundingClientRect();
      const w = rect.width || this.lastWidth || 360;
      const h = rect.height || this.lastHeight || 180;
      this.ctx.clearRect(0, 0, w, h);
    }

    this.updatePlaceholder();
    if (typeof this.onChange === 'function') {
      this.onChange(null);
    }
  }

  isEmpty() {
    const hasStrokes = this.strokes && this.strokes.length > 0;
    const hasImage = !!this.loadedImage;
    return !hasStrokes && !hasImage;
  }

  toDataURL() {
    if (this.isEmpty()) return null;
    return this.canvas.toDataURL('image/png');
  }

  loadFromDataURL(dataUrl) {
    if (!dataUrl) {
      this.clear();
      return;
    }

    const img = new Image();
    img.onload = () => {
      this.loadedImage = img;
      this.strokes = [];
      this.hasDrawn = true;
      this.updatePlaceholder();
      this.resize();
      this.redraw();
    };
    img.onerror = () => {
      console.warn('No se pudo cargar la imagen de firma');
    };
    img.src = dataUrl;
  }
}

window.DigitalSignaturePad = DigitalSignaturePad;
