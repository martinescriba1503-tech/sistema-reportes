/**
 * Smooth Signature Pad for Field Tablets and Touch Screens
 * Handles touch, stylus, and mouse with High-DPI support
 */
class DigitalSignaturePad {
  constructor(canvasElement, placeholderElement) {
    this.canvas = canvasElement;
    this.placeholder = placeholderElement;
    this.ctx = this.canvas.getContext('2d');
    this.isDrawing = false;
    this.points = [];
    this.hasDrawn = false;

    this.initCanvas();
    this.attachEvents();
  }

  initCanvas() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = this.canvas.getBoundingClientRect();
    
    // Set actual resolution
    this.canvas.width = (rect.width || 360) * ratio;
    this.canvas.height = (rect.height || 180) * ratio;

    this.ctx.scale(ratio, ratio);
    this.ctx.strokeStyle = '#031240';
    this.ctx.lineWidth = 2.5;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  }

  attachEvents() {
    // Resize observer
    window.addEventListener('resize', () => {
      // Maintain drawing on resize if any
      const saved = this.toDataURL();
      const hasContent = !this.isEmpty();
      this.initCanvas();
      if (hasContent && saved) {
        this.loadFromDataURL(saved);
      }
    });

    // Pointer / Touch / Mouse coordinates
    const getPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    };

    const startDraw = (e) => {
      e.preventDefault();
      this.isDrawing = true;
      this.hasDrawn = true;
      if (this.placeholder) this.placeholder.style.display = 'none';
      const pos = getPos(e);
      this.ctx.beginPath();
      this.ctx.moveTo(pos.x, pos.y);
    };

    const moveDraw = (e) => {
      if (!this.isDrawing) return;
      e.preventDefault();
      const pos = getPos(e);
      this.ctx.lineTo(pos.x, pos.y);
      this.ctx.stroke();
    };

    const stopDraw = (e) => {
      if (this.isDrawing) {
        this.isDrawing = false;
        this.ctx.closePath();
      }
    };

    // Mouse listeners
    this.canvas.addEventListener('mousedown', startDraw);
    window.addEventListener('mousemove', moveDraw);
    window.addEventListener('mouseup', stopDraw);

    // Touch listeners
    this.canvas.addEventListener('touchstart', startDraw, { passive: false });
    window.addEventListener('touchmove', moveDraw, { passive: false });
    window.addEventListener('touchend', stopDraw);
    window.addEventListener('touchcancel', stopDraw);
  }

  clear() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    this.ctx.clearRect(0, 0, this.canvas.width / ratio, this.canvas.height / ratio);
    this.hasDrawn = false;
    if (this.placeholder) this.placeholder.style.display = 'block';
  }

  isEmpty() {
    return !this.hasDrawn;
  }

  toDataURL() {
    if (this.isEmpty()) return null;
    return this.canvas.toDataURL('image/png');
  }

  loadFromDataURL(dataUrl) {
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => {
      const rect = this.canvas.getBoundingClientRect();
      this.ctx.drawImage(img, 0, 0, rect.width || 360, rect.height || 180);
      this.hasDrawn = true;
      if (this.placeholder) this.placeholder.style.display = 'none';
    };
    img.src = dataUrl;
  }
}

window.DigitalSignaturePad = DigitalSignaturePad;
