/**
 * Photo Manager with Client-Side Canvas Compression,
 * Reordering, Presets & Field Device Optimization
 */
class PhotoManager {
  constructor(containerElement, onPhotosChange) {
    this.container = containerElement;
    this.onPhotosChange = onPhotosChange;
    this.photos = []; // { id, dataUrl, description, timestamp }
    this.quickTags = [
      'Cambio de aceite',
      'Cambio de filtro de aire',
      'Cambio de filtro de aceite',
      'Cambio de separador de aceite',
      'Cambio de kit de válvula de admisión',
      'Cambio de kit de válvula termostática',
      'Cambio de kit de mínima presión',
      'Cambio de estirilla de polvo',
      'Limpieza completa de todo el equipo'
    ];
  }

  setPhotos(photos) {
    this.photos = photos || [];
    this.render();
  }

  getPhotos() {
    return this.photos;
  }

  // Compress image on canvas to keep reports lightweight
  async compressImage(file, maxWidth = 1280, maxHeight = 1280, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(compressedDataUrl);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async handleFiles(fileList) {
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (!file.type.startsWith('image/')) continue;

      try {
        const compressedUrl = await this.compressImage(file);
        this.photos.push({
          id: `photo-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          dataUrl: compressedUrl,
          description: '',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
      } catch (err) {
        console.error('Error procesando imagen:', err);
      }
    }

    this.render();
    if (this.onPhotosChange) this.onPhotosChange(this.photos);
  }

  movePhoto(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= this.photos.length) return;
    const temp = this.photos[index];
    this.photos[index] = this.photos[target];
    this.photos[target] = temp;
    this.render();
    if (this.onPhotosChange) this.onPhotosChange(this.photos);
  }

  deletePhoto(index) {
    if (confirm('¿Desea eliminar esta fotografía del reporte?')) {
      this.photos.splice(index, 1);
      this.render();
      if (this.onPhotosChange) this.onPhotosChange(this.photos);
    }
  }

  updateDescription(index, text) {
    if (this.photos[index]) {
      this.photos[index].description = text;
      if (this.onPhotosChange) this.onPhotosChange(this.photos);
    }
  }

  applyTag(index, tag) {
    if (this.photos[index]) {
      const current = this.photos[index].description;
      this.photos[index].description = current ? `${current} - ${tag}` : tag;
      this.render();
      if (this.onPhotosChange) this.onPhotosChange(this.photos);
    }
  }

  selectTag(index, tag) {
    if (!tag) return;
    if (this.photos[index]) {
      this.photos[index].description = tag;
      this.render();
      if (this.onPhotosChange) this.onPhotosChange(this.photos);
    }
  }

  render() {
    if (!this.container) return;

    if (this.photos.length === 0) {
      this.container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: #94A3B8; font-size: 0.9rem;">
          📷 Aún no ha adjuntado fotografías. Tome fotos con la cámara o seleccione imágenes de la galería arriba.
        </div>
      `;
      return;
    }

    this.container.innerHTML = this.photos.map((photo, idx) => `
      <div class="photo-card" data-idx="${idx}">
        <div class="photo-card-img-wrap">
          <img src="${photo.dataUrl}" alt="Foto ${idx + 1}" loading="lazy" />
          <span class="photo-card-badge">Foto #${idx + 1}</span>
          <div class="photo-card-actions">
            ${idx > 0 ? `
              <button type="button" class="btn-photo-action" title="Mover antes" onclick="window.photoManager.movePhoto(${idx}, -1)">
                ▲
              </button>
            ` : ''}
            ${idx < this.photos.length - 1 ? `
              <button type="button" class="btn-photo-action" title="Mover después" onclick="window.photoManager.movePhoto(${idx}, 1)">
                ▼
              </button>
            ` : ''}
            <button type="button" class="btn-photo-action delete" title="Eliminar" onclick="window.photoManager.deletePhoto(${idx})">
              ✕
            </button>
          </div>
        </div>
        <div class="photo-card-body">
          <label style="font-size: 0.72rem; font-weight: 700; color: var(--color-primary-dark); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.15rem; display: block;">
            📋 Actividad Realizada:
          </label>
          <select 
            class="form-control form-control-sm" 
            style="font-size: 0.82rem; font-weight: 600; padding: 0.35rem 0.5rem; border-color: var(--color-border); background-color: #F8FAFC; cursor: pointer; border-radius: 6px;"
            onchange="window.photoManager.selectTag(${idx}, this.value)"
          >
            <option value="">-- Seleccionar Actividad --</option>
            ${this.quickTags.map(tag => `
              <option value="${this.escapeHtml(tag)}" ${photo.description === tag ? 'selected' : ''}>
                ${tag}
              </option>
            `).join('')}
          </select>
          <input 
            type="text" 
            class="form-control form-control-sm" 
            placeholder="O escribe una descripción personalizada..." 
            value="${this.escapeHtml(photo.description)}"
            onchange="window.photoManager.updateDescription(${idx}, this.value)"
            oninput="window.photoManager.updateDescription(${idx}, this.value)"
            style="font-size: 0.82rem; margin-top: 0.25rem;"
          />
          <div class="photo-quick-tags" style="margin-top: 0.35rem;">
            ${this.quickTags.map(tag => `
              <button 
                type="button" 
                class="quick-tag-chip ${photo.description === tag ? 'active' : ''}" 
                title="Seleccionar ${tag}"
                onclick="window.photoManager.selectTag(${idx}, '${this.escapeHtml(tag)}')"
              >
                ${tag}
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    `).join('');
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

window.PhotoManager = PhotoManager;
