/**
 * INDUSTRAC S.A.C. — Aplicación Principal de Reportes Técnicos
 * Manejo de pasos, persistencia, catálogo, planes y generación de reportes
 */

// Textos técnicos estándar predefinidos según horas de servicio
const STANDARD_OBSERVATIONS = {
  '2000': 'Se realizó el cambio de filtro de aire y filtro de aceite. Se sopleteó todo el equipo y el compresor queda trabajando bajo sus parámetros normales.',
  '4000': 'Se realizó el mantenimiento de 4000 horas, procediendo al cambio de filtro de aire, filtro de aceite y filtro separador de aceite. Se sopleteó todo el equipo y queda trabajando bajo sus parámetros normales mecánicamente.',
  '8000': 'Se realizó el mantenimiento de 8000 horas, efectuando el cambio de aceite, filtro de aire, filtro de aceite, separador de aceite, kit de válvula de admisión, kit de válvula termostática, kit de mínima presión y estirilla de polvo. Se realizó la limpieza general de todo el equipo y queda trabajando bajo parámetros normales.'
};

function detectHoursKey(val) {
  if (val === null || val === undefined) return null;
  const str = String(val).toLowerCase().trim();
  if (!str) return null;

  if (str.includes('8000') || str === '8000' || str === '8000 hrs' || str === '8000 horas') return '8000';
  if (str.includes('4000') || str === '4000' || str === '4000 hrs' || str === '4000 horas') return '4000';
  if (str.includes('2000') || str === '2000' || str === '2000 hrs' || str === '2000 horas') return '2000';
  return null;
}

function getLocalDateString(dateObj = new Date()) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new IndustracApp();
  window.app.init();
});

class IndustracApp {
  constructor() {
    this.currentStep = 1;
    this.totalSteps = 9;
    this.clients = [];
    this.equipments = [];
    this.selectedClientId = 'all';
    this.catalogEquipmentSearch = '';
    this.catalogEquipmentStatus = 'all';
    this.catalogClientSearch = '';
    this.plans = null;
    this.reports = [];
    this.reportData = this.getEmptyReport();

    // Components
    this.pdfGen = new IndustracPdfGenerator();
    this.techSigPad = null;
    this.clientSigPad = null;
    this.photoManager = null;

    // Autosave timer
    this.autosaveDebounce = null;

    // Horómetros & Próximos Mantenimientos state
    this.horometersData = [];
    this.horometersSummary = null;
    this.horometerSearch = '';
    this.horometerStatusFilter = 'all';
    this.horometerPlanFilter = 'all';
    this.horometerCycleFilter = 'all';
    this.horometerMonthFilter = null;
    this.horometerSortBy = 'urgency';
    this.activeKpiFilter = null;
    this.currentHorometerEquipment = null;
    this.horometerMode = 'real';
    this.horometersPriorityList = [];
    this.horometersMonthlyProjection = null;
  }

  async init() {
    this.initElements();
    this.initSignatures();
    this.initPhotos();
    this.attachEventListeners();

    // Ensure initial date in form is today's local date
    const today = getLocalDateString();
    const dateInput = document.getElementById('field-date');
    if (dateInput && !dateInput.value) {
      dateInput.value = today;
      this.reportData.date = today;
    }

    // Carga inmediata desde almacenamiento local persistente (Anti-borrado en recarga de página)
    this.restoreLocalCatalogCache();

    // Fetch initial data
    await Promise.all([
      this.loadPlans(),
      this.loadClients(),
      this.loadEquipments(),
      this.loadReports(),
      this.loadHorometersData()
    ]);

    // Restore draft or start fresh
    this.restoreOrCreateDraft();
  }

  getEmptyReport() {
    return {
      id: null,
      reportNumber: '',
      date: getLocalDateString(),
      client: '',
      equipmentId: '',
      apiCode: '',
      address: '',
      technician: '',
      serviceType: 'Mantenimiento',
      maintenanceType: 'Plan A — 2000 horas',
      model: '',
      serialNumber: '',
      controller: '',
      pressure: '',
      airflow: '',
      hourMeter: '',
      oilType: 'Ndurance (Presentación 5 L)',
      oilQuantities: { '20 L': 0, '5 L': 0 },
      oilLevel: 'Alto', // 'Bajo' (rojo) | 'Medio' (naranja) | 'Alto' (verde)
      customOil: '',
      manufacturer: 'Atlas Copco',
      // Step 2: Mechanical
      mechanicalTasks: {},
      otherMechanicalTasks: '',
      pendingTasksReason: '',
      // Step 3: Electrical
      hasElectrical: false,
      electrical: {
        u1_u2: '', u2_u3: '', u1_u3: '',
        i_l1: '', i_l2: '', i_l3: '',
        f1: '', f2: '', f3: '',
        ground: ''
      },
      mainMotor: { brand: '', voltage: '', amperage: '', fs: '1.15', protection: 'IP55' },
      fanMotor: { voltage: '', amperage: '', fs: '1.0', protection: 'IP54' },
      // Step 4: Dryer
      hasDryer: false,
      dryer: {
        model: '', serialNumber: '', dewPoint: '3',
        voltage: '', amperage: '', protection: 'IP54',
        cleaning: 'Bueno', refrigerant: 'R134a'
      },
      // Step 5: Technical Parameters
      serviceLives: {
        oilLife: '', oilFilterLife: '', airFilterLife: '',
        separatorLife: '', motorGreaseLife: ''
      },
      regulations: {
        loadPressure: '', unloadPressure: '', vsdSetpoint: '',
        startsCount: '', loadDelay: '10'
      },
      technicalParameters: {
        elem1Temp: '', elem2Temp: '', oilTemp: '',
        airPressure: '', intermediatePressure: ''
      },
      // Step 6: Obs & Recs
      observations: STANDARD_OBSERVATIONS['2000'],
      recommendations: '',
      // Step 7: Photos
      photos: [],
      // Step 8: Signatures
      techSignature: null,
      techName: '',
      clientSignature: null,
      clientSignerName: '',
      clientSignerPosition: '',
      // Meta
      status: 'Borrador'
    };
  }

  initElements() {
    // Stepper navigation elements
    this.stepPanes = document.querySelectorAll('.form-step-pane');
    this.stepButtons = document.querySelectorAll('.stepper-step');
    this.progressBarFill = document.getElementById('progress-bar-fill');
    this.stepCounterText = document.getElementById('step-counter-text');

    // Bottom action buttons
    this.btnPrev = document.getElementById('btn-prev');
    this.btnNext = document.getElementById('btn-next');
    this.btnSaveDraft = document.getElementById('btn-save-draft');
    this.btnFinalize = document.getElementById('btn-finalize');

    // Electrical toggle
    this.electricalToggle = document.getElementById('has-electrical-toggle');
    this.electricalFieldsSection = document.getElementById('electrical-fields-section');
    this.noElectricalNotice = document.getElementById('no-electrical-notice');

    // Dryer toggle
    this.dryerToggle = document.getElementById('has-dryer-toggle');
    this.dryerFieldsSection = document.getElementById('dryer-fields-section');

    // Oil type other
    this.oilTypeSelect = document.getElementById('oil-type-select');
    this.customOilGroup = document.getElementById('custom-oil-group');
  }

  initSignatures() {
    const techCanvas = document.getElementById('tech-signature-canvas');
    const techPlaceholder = document.getElementById('tech-sig-placeholder');
    if (techCanvas) {
      this.techSigPad = new DigitalSignaturePad(techCanvas, techPlaceholder, (dataUrl) => {
        this.reportData.techSignature = dataUrl;
        this.triggerAutoSave();
      });
      document.getElementById('btn-clear-tech-sig')?.addEventListener('click', () => {
        this.techSigPad.clear();
        this.reportData.techSignature = null;
        this.triggerAutoSave();
      });
    }

    const clientCanvas = document.getElementById('client-signature-canvas');
    const clientPlaceholder = document.getElementById('client-sig-placeholder');
    if (clientCanvas) {
      this.clientSigPad = new DigitalSignaturePad(clientCanvas, clientPlaceholder, (dataUrl) => {
        this.reportData.clientSignature = dataUrl;
        this.triggerAutoSave();
      });
      document.getElementById('btn-clear-client-sig')?.addEventListener('click', () => {
        this.clientSigPad.clear();
        this.reportData.clientSignature = null;
        this.triggerAutoSave();
      });
    }
  }

  initPhotos() {
    const galleryEl = document.getElementById('photo-gallery-grid');
    if (galleryEl) {
      this.photoManager = new PhotoManager(galleryEl, (photos) => {
        this.reportData.photos = photos;
        this.triggerAutoSave();
      });
      window.photoManager = this.photoManager;

      // File input triggers
      const fileInput = document.getElementById('photo-file-input');
      const cameraInput = document.getElementById('photo-camera-input');
      const dropzone = document.getElementById('photo-dropzone');

      if (fileInput) {
        fileInput.addEventListener('change', (e) => {
          if (e.target.files.length) this.photoManager.handleFiles(e.target.files);
        });
      }

      if (cameraInput) {
        cameraInput.addEventListener('change', (e) => {
          if (e.target.files.length) this.photoManager.handleFiles(e.target.files);
        });
      }

      if (dropzone) {
        dropzone.addEventListener('dragover', (e) => {
          e.preventDefault();
          dropzone.classList.add('dragover');
        });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
        dropzone.addEventListener('drop', (e) => {
          e.preventDefault();
          dropzone.classList.remove('dragover');
          if (e.dataTransfer.files.length) this.photoManager.handleFiles(e.dataTransfer.files);
        });
      }
    }
  }

  attachEventListeners() {
    // Header navigation tabs
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tabId = btn.getAttribute('data-tab');
        this.switchTab(tabId);
      });
    });

    // Stepper navigation buttons
    this.btnPrev?.addEventListener('click', () => this.goToStep(this.currentStep - 1));
    this.btnNext?.addEventListener('click', () => this.goToStep(this.currentStep + 1));
    this.btnSaveDraft?.addEventListener('click', () => this.saveDraft(true));
    this.btnFinalize?.addEventListener('click', () => this.finalizeReport());

    // Direct stepper step click
    this.stepButtons.forEach((btn, index) => {
      btn.addEventListener('click', () => this.goToStep(index + 1));
    });

    // Two-step client & equipment selection
    const repClientSelect = document.getElementById('report-client-select');
    repClientSelect?.addEventListener('change', (e) => {
      this.onReportClientChanged(e.target.value);
    });

    const repEquipSelect = document.getElementById('report-equipment-select');
    repEquipSelect?.addEventListener('change', (e) => {
      if (e.target.value) this.applyEquipment(e.target.value);
    });

    // Fallback equipment quick-select if present
    const equipSelect = document.getElementById('equipment-quick-select');
    equipSelect?.addEventListener('change', (e) => {
      if (e.target.value) this.applyEquipment(e.target.value);
    });

    // Maintenance Type changed -> Suggest tasks & auto-load parts & autocomplete observations
    const maintTypeSelect = document.getElementById('maintenance-type-select');
    maintTypeSelect?.addEventListener('change', (e) => {
      this.reportData.maintenanceType = e.target.value;
      this.suggestMechanicalTasks(e.target.value);
      this.renderAutoLoadedPartsBox(e.target.value);
      this.handleHoursAutocomplete(e.target.value);
      this.triggerAutoSave();
    });

    // Horómetro changed -> Auto-detect hours for standard observations
    const hourmeterInput = document.getElementById('field-hourmeter');
    hourmeterInput?.addEventListener('input', (e) => {
      this.handleHoursAutocomplete(e.target.value);
    });
    hourmeterInput?.addEventListener('change', (e) => {
      this.handleHoursAutocomplete(e.target.value);
    });

    // Date input: click opens native picker, change syncs state
    const dateInput = document.getElementById('field-date');
    if (dateInput) {
      dateInput.addEventListener('click', () => {
        if (typeof dateInput.showPicker === 'function') {
          try {
            dateInput.showPicker();
          } catch (e) {}
        }
      });
      dateInput.addEventListener('change', (e) => {
        this.reportData.date = e.target.value;
        this.reportData.draftSavedOn = getLocalDateString();
        this.triggerAutoSave();
      });
    }

    // Today button to reset date to current local day
    const btnSetToday = document.getElementById('btn-set-date-today');
    if (btnSetToday) {
      btnSetToday.addEventListener('click', (e) => {
        e.preventDefault();
        const today = getLocalDateString();
        if (dateInput) {
          dateInput.value = today;
        }
        this.reportData.date = today;
        this.reportData.draftSavedOn = today;
        this.triggerAutoSave();
        this.showToast(`Fecha establecida en hoy: ${today}`, 'info');
      });
    }

    // Oil type changed in Step 1
    this.oilTypeSelect?.addEventListener('change', (e) => {
      const val = e.target.value;
      const isOther = val === 'Otro';
      if (this.customOilGroup) {
        this.customOilGroup.style.display = isOther ? 'flex' : 'none';
      }
      this.reportData.oilType = val;

      if (!this.reportData.oilQuantities) {
        this.reportData.oilQuantities = { '20 L': 0, '5 L': 0 };
      }

      // Pre-configurar presentación según la opción elegida
      const valLower = val.toLowerCase();
      const isSmall = (valLower.includes('5 l') || valLower.includes('5l') || valLower.includes('1gal')) && !valLower.includes('20') && !valLower.includes('5gal');
      const isLarge = valLower.includes('20') || valLower.includes('5gal');
      if (isSmall) {
        this.reportData.oilQuantities['5 L'] = this.reportData.oilQuantities['5 L'] || 1;
      } else if (isLarge) {
        this.reportData.oilQuantities['20 L'] = this.reportData.oilQuantities['20 L'] || 1;
      }

      this.renderAutoLoadedPartsBox(this.reportData.maintenanceType);
      this.triggerAutoSave();
    });

    const customOilInput = document.getElementById('field-custom-oil');
    customOilInput?.addEventListener('input', (e) => {
      this.reportData.customOil = e.target.value;
      this.renderAutoLoadedPartsBox(this.reportData.maintenanceType);
      this.triggerAutoSave();
    });

    // Electrical switch toggle
    this.electricalToggle?.addEventListener('change', (e) => {
      const hasElectrical = e.target.checked;
      this.reportData.hasElectrical = hasElectrical;
      if (this.electricalFieldsSection) {
        this.electricalFieldsSection.style.display = hasElectrical ? 'block' : 'none';
      }
      if (this.noElectricalNotice) {
        this.noElectricalNotice.style.display = hasElectrical ? 'none' : 'block';
      }
      this.triggerAutoSave();
    });

    // Dryer switch toggle
    this.dryerToggle?.addEventListener('change', (e) => {
      const hasDryer = e.target.checked;
      this.reportData.hasDryer = hasDryer;
      if (this.dryerFieldsSection) {
        this.dryerFieldsSection.style.display = hasDryer ? 'block' : 'none';
      }
      this.triggerAutoSave();
    });

    // Listen to form inputs for two-way binding & autosave
    document.querySelectorAll('#report-form input, #report-form select, #report-form textarea').forEach(el => {
      el.addEventListener('input', () => {
        this.syncFormToState();
        this.triggerAutoSave();
      });
      el.addEventListener('change', () => {
        this.syncFormToState();
        this.triggerAutoSave();
      });
    });

    // Sync technician selection to signature tech name if empty
    const techSelect = document.getElementById('field-technician');
    techSelect?.addEventListener('change', (e) => {
      const selectedTech = e.target.value;
      const techNameInput = document.getElementById('field-tech-name');
      if (techNameInput && (!techNameInput.value || techNameInput.value === this.reportData.technician)) {
        techNameInput.value = selectedTech;
        this.reportData.techName = selectedTech;
      }
    });

    // Equipment and Client catalog events
    document.getElementById('btn-new-equipment')?.addEventListener('click', () => this.openEquipmentModal());
    document.getElementById('btn-new-client')?.addEventListener('click', () => this.openClientModal());
    document.getElementById('btn-demo-manager')?.addEventListener('click', () => this.openDemoManagerModal());
    document.getElementById('equipment-form')?.addEventListener('submit', (e) => this.saveEquipment(e));
    document.getElementById('client-form')?.addEventListener('submit', (e) => this.saveClient(e));

    // Catalog filtering events
    document.getElementById('catalog-client-search')?.addEventListener('input', (e) => this.filterCatalogClients(e.target.value));
    document.getElementById('catalog-equipment-search')?.addEventListener('input', (e) => this.filterCatalogEquipments(e.target.value));
    document.getElementById('catalog-equipment-status-filter')?.addEventListener('change', (e) => this.filterCatalogEquipmentsByStatus(e.target.value));

    // Detail modal actions
    document.getElementById('btn-edit-from-detail')?.addEventListener('click', () => {
      const eqId = document.getElementById('detail-modal-title')?.getAttribute('data-eq-id');
      this.closeEquipmentDetailModal();
      if (eqId) this.openEquipmentModal(eqId);
    });

    document.getElementById('btn-start-service-from-detail')?.addEventListener('click', () => {
      const eqId = document.getElementById('detail-modal-title')?.getAttribute('data-eq-id');
      this.closeEquipmentDetailModal();
      if (eqId) this.startReportForEquipment(eqId);
    });

    document.getElementById('btn-create-report-from-detail')?.addEventListener('click', () => {
      const eqId = document.getElementById('detail-modal-title')?.getAttribute('data-eq-id');
      this.closeEquipmentDetailModal();
      if (eqId) this.startReportForEquipment(eqId);
    });

    // Horómetros toolbar events
    document.getElementById('horometer-search-input')?.addEventListener('input', (e) => {
      this.horometerSearch = e.target.value;
      this.filterAndRenderHorometers();
    });

    document.getElementById('horometer-status-filter')?.addEventListener('change', (e) => {
      this.horometerStatusFilter = e.target.value;
      this.activeKpiFilter = null;
      this.filterAndRenderHorometers();
    });

    document.getElementById('horometer-plan-filter')?.addEventListener('change', (e) => {
      this.horometerPlanFilter = e.target.value;
      this.filterAndRenderHorometers();
    });

    document.getElementById('horometer-sort-select')?.addEventListener('change', (e) => {
      this.horometerSortBy = e.target.value;
      this.filterAndRenderHorometers();
    });

    document.getElementById('field-new-reading-hours')?.addEventListener('input', () => {
      this.onReadingInputChanged();
    });
  }

  // --- TAB NAVIGATION ---
  switchTab(tabId) {
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });

    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === tabId);
    });

    if (tabId === 'tab-history') {
      this.loadReports();
    } else if (tabId === 'tab-equipments') {
      this.renderClientsList();
      this.renderEquipmentsCatalog();
    } else if (tabId === 'tab-plans') {
      this.renderPlansView();
    } else if (tabId === 'tab-horometers') {
      this.loadHorometersData();
    }
  }

  // --- STEPPER LOGIC ---
  goToStep(stepNumber) {
    if (stepNumber < 1 || stepNumber > this.totalSteps) return;

    this.syncFormToState();

    // Validation checks when moving forward
    if (stepNumber > this.currentStep) {
      if (this.currentStep === 1 && !this.reportData.client) {
        this.showToast('Por favor ingrese al menos el nombre del Cliente.', 'warning');
      }
    }

    this.currentStep = stepNumber;

    // Update stepper visual state
    this.stepPanes.forEach((pane, idx) => {
      pane.classList.toggle('active', idx + 1 === stepNumber);
    });

    this.stepButtons.forEach((btn, idx) => {
      const stepIdx = idx + 1;
      btn.classList.toggle('active', stepIdx === stepNumber);
      btn.classList.toggle('completed', stepIdx < stepNumber);
    });

    const progressPct = Math.round((stepNumber / this.totalSteps) * 100);
    if (this.progressBarFill) this.progressBarFill.style.width = `${progressPct}%`;
    if (this.stepCounterText) this.stepCounterText.textContent = `Paso ${stepNumber} de ${this.totalSteps} (${progressPct}%)`;

    // Toggle button visibility
    if (this.btnPrev) this.btnPrev.style.display = stepNumber === 1 ? 'none' : 'inline-flex';
    if (this.btnNext) this.btnNext.style.display = stepNumber === this.totalSteps ? 'none' : 'inline-flex';
    if (this.btnFinalize) this.btnFinalize.style.display = stepNumber === this.totalSteps ? 'inline-flex' : 'none';

    // If reaching step 2, ensure form state is synced and auto-loaded parts box is rendered
    if (stepNumber === 2) {
      this.syncFormToState();
      this.renderAutoLoadedPartsBox(this.reportData.maintenanceType);
    }

    // If reaching step 6 (Observaciones), ensure autofill if empty
    if (stepNumber === 6) {
      if (!this.reportData.observations || !this.reportData.observations.trim()) {
        const key = detectHoursKey(this.reportData.maintenanceType) || detectHoursKey(this.reportData.hourMeter) || '2000';
        this.applyStandardObservation(key, false);
      }
    }

    // If reaching step 8 (Firmas), ensure technician name is set and canvases resize to visible dimensions
    if (stepNumber === 8) {
      const techInput = document.getElementById('field-tech-name');
      if (techInput && !techInput.value && this.reportData.technician) {
        techInput.value = this.reportData.technician;
        this.reportData.techName = this.reportData.technician;
      }
      requestAnimationFrame(() => {
        this.techSigPad?.resize();
        this.clientSigPad?.resize();
      });
    }

    // If reaching step 9 (Review), render summary
    if (stepNumber === 9) {
      this.renderReviewSummary();
    }

    // Scroll to top of form smoothly
    window.scrollTo({ top: 120, behavior: 'smooth' });
  }

  // --- DATA LOADING & PLANS ---
  async loadPlans() {
    try {
      const res = await fetch('/api/plans');
      this.plans = await res.json();
      this.renderMechanicalTasksList();
      this.suggestMechanicalTasks(this.reportData.maintenanceType);
      this.renderAutoLoadedPartsBox(this.reportData.maintenanceType);
    } catch (err) {
      console.warn('Error cargando planes del servidor:', err);
    }
  }

  // --- PERSISTENCIA LOCAL Y ANTI-BORRADO EN RECARGAS ---
  restoreLocalCatalogCache() {
    try {
      const rawClients = localStorage.getItem('industrac_catalog_clients');
      const rawEquipments = localStorage.getItem('industrac_catalog_equipments');
      if (rawClients) {
        const parsed = JSON.parse(rawClients);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.clients = parsed;
        }
      }
      if (rawEquipments) {
        const parsedEq = JSON.parse(rawEquipments);
        if (Array.isArray(parsedEq) && parsedEq.length > 0) {
          this.equipments = parsedEq;
        }
      }
      this.recalculateClientCounts();
      this.renderClientsList();
      this.renderEquipmentsCatalog();
      this.updateCatalogBadges();
      this.populateReportClientSelect();
      this.populateModalClientSelect();
    } catch (e) {
      console.warn('Aviso: error al restaurar caché local del catálogo:', e);
    }
  }

  persistLocalCatalogCache() {
    try {
      if (Array.isArray(this.clients)) {
        localStorage.setItem('industrac_catalog_clients', JSON.stringify(this.clients));
      }
      if (Array.isArray(this.equipments)) {
        localStorage.setItem('industrac_catalog_equipments', JSON.stringify(this.equipments));
      }
    } catch (e) {
      console.warn('Aviso: no se pudo guardar catálogo en localStorage:', e);
    }
  }

  recalculateClientCounts() {
    if (!this.clients || !Array.isArray(this.clients)) return;
    const equipments = this.equipments || [];
    this.clients.forEach(c => {
      const cId = c.id;
      const cName = (c.name || '').toLowerCase().trim();
      const matched = equipments.filter(e => {
        if (e.clientId && e.clientId === cId) return true;
        if (e.client && e.client.toLowerCase().trim() === cName) return true;
        return false;
      });
      c.equipmentCount = matched.length;
      c.activeEquipmentCount = matched.filter(e => e.status !== 'Inactivo' && e.active !== false).length;
    });
  }

  async loadClients() {
    try {
      const res = await fetch('/api/clients');
      if (!res.ok) throw new Error('Error al consultar /api/clients');
      const serverClients = await res.json();

      let deletedClients = [];
      try {
        deletedClients = JSON.parse(localStorage.getItem('industrac_deleted_clients') || '[]');
      } catch (e) {}

      const filteredServerClients = (serverClients || []).filter(sc => 
        sc && 
        !deletedClients.includes(sc.id) && 
        !(sc.name && deletedClients.includes(sc.name.trim().toLowerCase()))
      );

      const clientMap = new Map();
      (this.clients || []).forEach(c => {
        if (!c || !c.id) return;
        if (!deletedClients.includes(c.id) && !(c.name && deletedClients.includes(c.name.trim().toLowerCase()))) {
          clientMap.set(c.id, c);
        }
      });

      filteredServerClients.forEach(sc => {
        if (!sc || !sc.id) return;
        const existing = clientMap.get(sc.id);
        if (existing) {
          const existingTime = new Date(existing.updatedAt || 0).getTime();
          const serverTime = new Date(sc.updatedAt || 0).getTime();
          if (existingTime > serverTime) {
            clientMap.set(sc.id, { ...sc, ...existing });
          } else {
            clientMap.set(sc.id, { ...existing, ...sc });
          }
        } else {
          clientMap.set(sc.id, sc);
        }
      });

      this.clients = Array.from(clientMap.values());
      this.persistLocalCatalogCache();
      this.recalculateClientCounts();
      this.renderClientsList();
      this.updateCatalogBadges();
      this.populateReportClientSelect();
      this.populateModalClientSelect();
    } catch (err) {
      console.warn('Error cargando clientes del servidor (usando caché local persistente):', err);
      this.recalculateClientCounts();
      this.renderClientsList();
      this.updateCatalogBadges();
      this.populateReportClientSelect();
      this.populateModalClientSelect();
    }
  }

  async loadEquipments() {
    try {
      const res = await fetch('/api/equipments');
      if (!res.ok) throw new Error('Error al consultar /api/equipments');
      const serverEquipments = await res.json();

      let deletedIds = [];
      try {
        deletedIds = JSON.parse(localStorage.getItem('industrac_deleted_equipments') || '[]');
      } catch (e) {}

      // Filtrar equipos eliminados localmente
      const filteredServerEquipments = (serverEquipments || []).filter(se => 
        se && 
        !deletedIds.includes(se.id) && 
        !(se.apiCode && deletedIds.includes(se.apiCode))
      );

      // Usar equipos existentes en memoria / caché local que no estén marcados como eliminados
      const eqMap = new Map();
      (this.equipments || []).forEach(e => {
        if (!e) return;
        const key = e.id || e.apiCode;
        if (key && !deletedIds.includes(e.id) && !(e.apiCode && deletedIds.includes(e.apiCode))) {
          eqMap.set(key, e);
        }
      });

      // Fusión inteligente: si hay cambios locales más recientes, conservarlos
      filteredServerEquipments.forEach(se => {
        if (!se) return;
        const key = se.id || se.apiCode;
        if (key) {
          const existing = eqMap.get(key);
          if (existing) {
            const existingTime = new Date(existing.updatedAt || 0).getTime();
            const serverTime = new Date(se.updatedAt || 0).getTime();
            if (existingTime > serverTime) {
              eqMap.set(key, { ...se, ...existing });
            } else {
              eqMap.set(key, { ...existing, ...se });
            }
          } else {
            eqMap.set(key, se);
          }
        }
      });

      this.equipments = Array.from(eqMap.values());
      this.persistLocalCatalogCache();
      this.recalculateClientCounts();
      this.renderEquipmentsCatalog();
      this.updateCatalogBadges();
      this.syncReportEquipmentSelects();
    } catch (err) {
      console.warn('Error cargando equipos del servidor (usando caché local persistente):', err);
      this.recalculateClientCounts();
      this.renderEquipmentsCatalog();
      this.updateCatalogBadges();
    }
  }

  async loadReports() {
    try {
      const res = await fetch('/api/reports');
      this.reports = await res.json();
      this.renderHistoryTable();
    } catch (err) {
      console.warn('Error cargando historial de reportes:', err);
    }
  }

  // --- TWO-STEP REPORT EQUIPMENT SELECTION ---
  populateReportClientSelect() {
    const select = document.getElementById('report-client-select');
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Elija un Cliente del Catálogo --</option>' +
      this.clients.map(c => `
        <option value="${c.id}" ${c.id === currentVal ? 'selected' : ''}>${c.name} (${c.equipmentCount || 0} equipos)</option>
      `).join('');
  }

  onReportClientChanged(clientId, clearEquipment = true) {
    const equipSelect = document.getElementById('report-equipment-select');
    if (!equipSelect) return;

    if (!clientId) {
      equipSelect.disabled = true;
      equipSelect.innerHTML = '<option value="">-- Primero elija un cliente --</option>';
      if (clearEquipment) this.clearEquipmentSelection(false);
      return;
    }

    const client = this.clients.find(c => c.id === clientId);
    if (client) {
      const fieldClient = document.getElementById('field-client');
      if (fieldClient) fieldClient.value = client.name;
      const fieldAddress = document.getElementById('field-address');
      if (fieldAddress) fieldAddress.value = client.address || '';
      this.reportData.client = client.name;
      this.reportData.address = client.address || '';
    }

    // Filter equipments belonging to this client
    const clientEquipments = this.equipments.filter(e => e.clientId === clientId || (client && e.client && e.client.toLowerCase() === client.name.toLowerCase()));

    equipSelect.disabled = false;
    if (clientEquipments.length === 0) {
      equipSelect.innerHTML = '<option value="">-- Sin equipos registrados para este cliente --</option>';
    } else {
      equipSelect.innerHTML = '<option value="">-- Seleccionar Compresor a Intervenir --</option>' +
        clientEquipments.map(e => `
          <option value="${e.id}">[${e.apiCode || e.serialNumber || 'ID'}] ${e.model}${e.location ? ` • ${e.location}` : ''}${e.status === 'Inactivo' ? ' - INACTIVO' : ''}</option>
        `).join('');
    }

    if (clearEquipment) {
      this.clearEquipmentSelection(false);
    }
  }

  onReportEquipmentChanged(equipmentId) {
    if (equipmentId) {
      this.applyEquipment(equipmentId);
    } else {
      this.clearEquipmentSelection(false);
    }
  }

  populateModalClientSelect() {
    const select = document.getElementById('modal-eq-client-select');
    if (!select) return;
    select.innerHTML = '<option value="">-- Seleccionar Cliente Existente --</option>' +
      this.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  syncReportEquipmentSelects() {
    const clientSelect = document.getElementById('report-client-select');
    const equipSelect = document.getElementById('report-equipment-select');
    const tag = document.getElementById('equipment-selected-tag');
    if (!clientSelect || !equipSelect) return;

    if (this.reportData.equipmentId) {
      const eq = this.equipments.find(e => e.id === this.reportData.equipmentId);
      if (eq) {
        if (eq.clientId) clientSelect.value = eq.clientId;
        this.onReportClientChanged(eq.clientId || clientSelect.value, false);
        equipSelect.value = eq.id;

        if (tag) {
          tag.style.display = 'flex';
          const codeEl = document.getElementById('tag-selected-api-code');
          const infoEl = document.getElementById('tag-selected-info');
          if (codeEl) codeEl.textContent = eq.apiCode || eq.serialNumber || 'DEMO';
          if (infoEl) infoEl.textContent = `${eq.model} [${eq.apiCode || eq.serialNumber || 'N/A'}] • ${eq.client}`;
        }
        return;
      }
    }

    if (!this.reportData.equipmentId && tag) {
      tag.style.display = 'none';
    }
  }

  clearEquipmentSelection(clearClient = true) {
    this.reportData.equipmentId = '';
    this.reportData.apiCode = '';
    const idInput = document.getElementById('field-equipment-id');
    const apiInput = document.getElementById('field-api-code');
    if (idInput) idInput.value = '';
    if (apiInput) apiInput.value = '';

    const tag = document.getElementById('equipment-selected-tag');
    if (tag) tag.style.display = 'none';

    const equipSelect = document.getElementById('report-equipment-select');
    if (equipSelect) equipSelect.value = '';

    if (clearClient) {
      const clientSelect = document.getElementById('report-client-select');
      if (clientSelect) clientSelect.value = '';
      if (equipSelect) {
        equipSelect.disabled = true;
        equipSelect.innerHTML = '<option value="">-- Primero elija un cliente --</option>';
      }
    }
  }

  applyEquipment(equipmentId) {
    const eq = this.equipments.find(e => e.id === equipmentId);
    if (!eq) return;

    const apiCodeVal = eq.apiCode || eq.serialNumber || '';
    this.reportData.equipmentId = eq.id;
    this.reportData.apiCode = apiCodeVal;
    this.reportData.serialNumber = apiCodeVal;
    this.reportData.client = eq.client || '';
    this.reportData.address = eq.address || '';
    this.reportData.manufacturer = eq.manufacturer || 'Atlas Copco';
    this.reportData.model = eq.model || '';
    this.reportData.controller = eq.controller || '';
    this.reportData.pressure = (eq.pressure || '').replace(/\s*bar\s*/i, '').trim();
    this.reportData.airflow = (eq.airflow || '').replace(/\s*m³\/min\s*/i, '').trim();
    const rawOil = eq.oilType || 'Ndurance (Presentación 5 L)';
    this.reportData.oilType = (rawOil === 'NDURANCE') ? 'Ndurance (Presentación 5 L)' : rawOil;
    this.reportData.customOil = eq.customOil || '';

    if (eq.hourMeter && eq.hourMeter !== 'Pendiente de completar' && eq.hourMeter !== '0') {
      this.reportData.hourMeter = eq.hourMeter;
    }

    if (eq.hasDryer) {
      this.reportData.hasDryer = true;
      this.reportData.dryer.model = eq.dryerModel || '';
      this.reportData.dryer.serialNumber = eq.dryerSerial || '';
    }

    this.syncStateToForm();

    // Explicitly guarantee DOM fields in Especificaciones Técnicas are updated
    const apiField = document.getElementById('field-api-code');
    if (apiField) apiField.value = apiCodeVal;
    const modelField = document.getElementById('field-model');
    if (modelField) modelField.value = eq.model || '';
    const ctrlField = document.getElementById('field-controller');
    if (ctrlField) ctrlField.value = eq.controller || '';
    const pressField = document.getElementById('field-pressure');
    if (pressField) pressField.value = this.reportData.pressure;
    const airField = document.getElementById('field-airflow');
    if (airField) airField.value = this.reportData.airflow;
    const idField = document.getElementById('field-equipment-id');
    if (idField) idField.value = eq.id;

    const tag = document.getElementById('equipment-selected-tag');
    if (tag) {
      tag.style.display = 'flex';
      const codeEl = document.getElementById('tag-selected-api-code');
      const infoEl = document.getElementById('tag-selected-info');
      if (codeEl) codeEl.textContent = apiCodeVal || 'DEMO';
      if (infoEl) infoEl.textContent = `${eq.model} [${apiCodeVal}] • ${eq.client}${eq.location ? ` (${eq.location})` : ''}`;
    }

    this.suggestMechanicalTasks(this.reportData.maintenanceType, eq.model);
    this.handleHoursAutocomplete(this.reportData.maintenanceType || eq.hourMeter, false);
    this.showToast(`Datos vinculados: ${eq.model} [${apiCodeVal || 'DEMO'}] (${eq.client})`, 'success');
    this.triggerAutoSave();
  }

  startReportForEquipment(equipmentId) {
    this.applyEquipment(equipmentId);
    this.switchTab('tab-report');
    this.goToStep(1);
    this.showToast('Compresor cargado en el nuevo reporte.', 'info');
  }

  // --- MECHANICAL TASKS PROTOCOL ---
  renderMechanicalTasksList() {
    const container = document.getElementById('tasks-checkbox-grid');
    if (!container || !this.plans) return;

    const allTasks = this.plans.allTasks || [];
    container.innerHTML = allTasks.map(task => `
      <div 
        class="task-item-card ${this.reportData.mechanicalTasks[task.id] ? 'checked' : ''}" 
        id="task-card-${task.id}"
        onclick="window.app.toggleTask('${task.id}')"
      >
        <div class="task-checkbox-custom">
          ${this.reportData.mechanicalTasks[task.id] ? '✓' : ''}
        </div>
        <div class="task-name">${task.name}</div>
      </div>
    `).join('');
  }

  toggleTask(taskId) {
    const current = !!this.reportData.mechanicalTasks[taskId];
    this.reportData.mechanicalTasks[taskId] = !current;

    const card = document.getElementById(`task-card-${taskId}`);
    if (card) {
      card.classList.toggle('checked', !current);
      const box = card.querySelector('.task-checkbox-custom');
      if (box) box.textContent = !current ? '✓' : '';
    }

    this.triggerAutoSave();
  }

  normalizeMaintenanceType(type) {
    if (!type) return 'Plan A — 2000 horas';
    const str = String(type).trim();
    if (str.includes('4000') || /plan\s*b/i.test(str)) return 'Plan B — 4000 horas';
    if (str.includes('8000') || /plan\s*c/i.test(str)) return 'Plan C — 8000 horas';
    if (str.includes('2000') || /plan\s*a/i.test(str)) return 'Plan A — 2000 horas';
    if (/overhaul/i.test(str)) return 'Overhaul';
    if (/correctivo/i.test(str)) return 'Correctivo';
    if (/otro/i.test(str)) return 'Otro';
    return str;
  }

  resolvePlanKey(type) {
    if (!type) return 'Plan A — 2000 horas';
    const normalized = this.normalizeMaintenanceType(type);
    if (this.plans?.defaultPlans?.[normalized]) return normalized;
    if (this.plans?.defaultPlans?.[type]) return type;
    return normalized || type;
  }

  getOilBrandName() {
    const raw = (this.reportData.oilType || document.getElementById('oil-type-select')?.value || '').trim();
    if (raw === 'Otro' || (this.reportData.customOil && this.reportData.customOil.trim())) {
      const custom = (this.reportData.customOil || document.getElementById('field-custom-oil')?.value || '').trim();
      return custom ? `Aceite ${custom}` : 'Aceite Personalizado';
    }
    if (/ndurance/i.test(raw)) {
      return 'Aceite Ndurance';
    }
    if (/sigma/i.test(raw)) {
      return 'Aceite Sigma';
    }
    if (/roto-inject/i.test(raw)) {
      return 'Aceite Roto-Inject';
    }
    if (/roto\s*-?\s*xtend/i.test(raw)) {
      return 'Aceite Roto Xtend';
    }
    if (raw) {
      const clean = raw.split('(')[0].replace(/^Aceite\s+/i, '').trim();
      return clean ? `Aceite ${clean}` : 'Aceite Lubricante';
    }
    return 'Aceite Roto Xtend';
  }

  suggestMechanicalTasks(maintenanceType, model = null) {
    if (!this.plans || !this.plans.defaultPlans) return;

    const resolvedKey = this.resolvePlanKey(maintenanceType);

    // Auto-select oil presentation for Plan B and Plan C if not already configured
    if (resolvedKey.includes('4000') || resolvedKey.includes('8000')) {
      const currentBrand = this.getOilBrandName();
      const rawLower = (this.reportData.oilType || '').toLowerCase();
      const is5LOnly = (rawLower.includes('5 l') || rawLower.includes('1gal')) && !rawLower.includes('20') && !rawLower.includes('5gal');

      if (!this.reportData.oilQuantities || (this.reportData.oilQuantities['20 L'] === 0 && this.reportData.oilQuantities['5 L'] === 0)) {
        this.reportData.oilQuantities = is5LOnly 
          ? { '20 L': 0, '5 L': 1 }
          : { '20 L': 1, '5 L': 0 };

        const desc = is5LOnly ? `${currentBrand} (1x 5L — 5 L)` : `${currentBrand} (1x 20L — 20 L)`;
        this.reportData.oilType = desc;
      }
    }

    // Determine tasks
    let suggestedIds = [];
    const modelPlans = this.plans.customModelPlans || {};
    if (model && modelPlans[model] && (modelPlans[model][resolvedKey] || modelPlans[model][maintenanceType])) {
      suggestedIds = modelPlans[model][resolvedKey] || modelPlans[model][maintenanceType];
    } else if (this.plans.defaultPlans[resolvedKey]) {
      suggestedIds = this.plans.defaultPlans[resolvedKey].suggestedTasks || [];
    } else if (this.plans.defaultPlans[maintenanceType]) {
      suggestedIds = this.plans.defaultPlans[maintenanceType].suggestedTasks || [];
    }

    // Set suggestions as initial selections without overwriting user changes rigidly
    const allTasks = this.plans.allTasks || [];
    allTasks.forEach(task => {
      const isSuggested = suggestedIds.includes(task.id);
      this.reportData.mechanicalTasks[task.id] = isSuggested;

      const card = document.getElementById(`task-card-${task.id}`);
      if (card) {
        card.classList.toggle('checked', isSuggested);
        card.classList.toggle('suggested', isSuggested);
        const box = card.querySelector('.task-checkbox-custom');
        if (box) box.textContent = isSuggested ? '✓' : '';
      }
    });

    // Update alert text
    const alertEl = document.getElementById('tasks-suggestion-text');
    if (alertEl) {
      const planObj = this.plans.defaultPlans[resolvedKey] || {};
      const autoItems = planObj.autoLoadItems || [];
      if (autoItems.length > 0) {
        alertEl.innerHTML = `<strong>${resolvedKey}</strong>: Carga automática de <strong>${autoItems.join(', ')}</strong> aplicada. Puede ajustar la ejecución según la realidad en campo.`;
      } else {
        alertEl.innerHTML = `Tareas recomendadas para <strong>${resolvedKey}</strong> aplicadas. Puede marcar o desmarcar libremente.`;
      }
    }

    this.renderAutoLoadedPartsBox(resolvedKey);
  }

  renderAutoLoadedPartsBox(maintenanceType) {
    const box = document.getElementById('auto-loaded-parts-box');
    if (!box || !this.plans) return;

    const resolvedKey = this.resolvePlanKey(maintenanceType);
    const plan = this.plans.defaultPlans?.[resolvedKey] || {};
    const autoItems = plan.autoLoadItems || [];

    if (!autoItems || autoItems.length === 0) {
      box.innerHTML = `
        <div class="auto-parts-header">
          <div class="auto-parts-title">
            <span>⚙️</span>
            <span>Repuestos e Insumos: <strong>${resolvedKey}</strong></span>
          </div>
          <span class="auto-parts-badge">Selección Libre</span>
        </div>
        <p style="color: #64748B; font-size: 0.85rem; margin: 0;">Selección técnica bajo demanda según las necesidades del equipo en campo.</p>
      `;
      return;
    }

    if (!this.reportData.oilQuantities) {
      const is20 = (this.reportData.oilType || '').includes('20');
      const is5 = (this.reportData.oilType || '').includes('5');
      this.reportData.oilQuantities = {
        '20 L': is20 ? 1 : (is5 ? 0 : 1),
        '5 L': is5 ? 1 : 0
      };
    }

    const q20 = this.reportData.oilQuantities['20 L'] || 0;
    const q5 = this.reportData.oilQuantities['5 L'] || 0;
    const totalLiters = (q20 * 20) + (q5 * 5);
    const hasOil = totalLiters > 0;

    const itemsHtml = autoItems.map(item => {
      const isOil = (item.toLowerCase().includes('aceite') && !item.toLowerCase().includes('filtro')) || item.toLowerCase().includes('roto xtend');

      if (isOil) {
        const brandTitle = this.getOilBrandName();

        return `
          <div class="auto-part-item active auto-part-oil-item">
            <div class="oil-item-top">
              <div class="auto-part-left">
                <div class="auto-part-icon">✓</div>
                <span class="oil-item-name" id="oil-item-title" title="${brandTitle}">${brandTitle}</span>
              </div>
              <span class="auto-part-badge-tag oil-total-tag ${hasOil ? '' : 'empty'}" id="oil-total-tag">${hasOil ? `${totalLiters} L` : '0 L'}</span>
            </div>

            <div class="oil-item-inputs">
              <!-- Presentación 20 L -->
              <div class="oil-mini-group">
                <span class="oil-mini-label">20 L:</span>
                <div class="oil-mini-stepper">
                  <button type="button" class="oil-mini-btn" onclick="window.app.adjustOilQuantity('20 L', -1)" title="Restar 20L">−</button>
                  <input 
                    type="number" 
                    id="oil-qty-input-20l" 
                    class="oil-mini-input" 
                    min="0" 
                    max="50" 
                    value="${q20}" 
                    oninput="window.app.setOilQuantity('20 L', this.value, true)"
                    onchange="window.app.setOilQuantity('20 L', this.value, false)"
                  />
                  <button type="button" class="oil-mini-btn" onclick="window.app.adjustOilQuantity('20 L', 1)" title="Sumar 20L">+</button>
                </div>
                <span class="oil-mini-subtotal" id="oil-subtotal-20l">${q20 * 20}L</span>
              </div>

              <!-- Presentación 5 L -->
              <div class="oil-mini-group">
                <span class="oil-mini-label">5 L:</span>
                <div class="oil-mini-stepper">
                  <button type="button" class="oil-mini-btn" onclick="window.app.adjustOilQuantity('5 L', -1)" title="Restar 5L">−</button>
                  <input 
                    type="number" 
                    id="oil-qty-input-5l" 
                    class="oil-mini-input" 
                    min="0" 
                    max="50" 
                    value="${q5}" 
                    oninput="window.app.setOilQuantity('5 L', this.value, true)"
                    onchange="window.app.setOilQuantity('5 L', this.value, false)"
                  />
                  <button type="button" class="oil-mini-btn" onclick="window.app.adjustOilQuantity('5 L', 1)" title="Sumar 5L">+</button>
                </div>
                <span class="oil-mini-subtotal" id="oil-subtotal-5l">${q5 * 5}L</span>
              </div>
            </div>
          </div>
        `;
      }

      // Demás repuestos (filtros, válvulas, drenajes, etc.) permanecen con la lógica estándar
      let icon = '📦';
      let tag = '1 Unidad';
      if (item.toLowerCase().includes('filtro')) {
        icon = '🛡️';
        tag = 'Filtración';
      } else if (item.toLowerCase().includes('válvula') || item.toLowerCase().includes('valvula')) {
        icon = '🔧';
        tag = 'Kit Válvula';
      } else if (item.toLowerCase().includes('drenaje')) {
        icon = '💧';
        tag = 'Kit Drenaje';
      }

      return `
        <div class="auto-part-item active">
          <div style="display: flex; flex-direction: column; gap: 0.2rem; flex: 1;">
            <div class="auto-part-left">
              <div class="auto-part-icon">✓</div>
              <span>${item}</span>
            </div>
          </div>
          <span class="auto-part-badge-tag">${tag}</span>
        </div>
      `;
    }).join('');

    box.innerHTML = `
      <div class="auto-parts-header">
        <div class="auto-parts-title">
          <span>⚡</span>
          <span>Cargar automáticamente: <strong>${resolvedKey}</strong></span>
        </div>
        <span class="auto-parts-badge">✓ Carga Automática Activa</span>
      </div>
      <div class="auto-parts-grid">
        ${itemsHtml}
      </div>
    `;
  }

  setOilQuantity(pres, val, isDirectInput = false) {
    if (!this.reportData.oilQuantities) {
      this.reportData.oilQuantities = { '20 L': 0, '5 L': 0 };
    }
    let num = parseInt(val, 10);
    if (isNaN(num) || num < 0) num = 0;
    if (num > 50) num = 50;

    this.reportData.oilQuantities[pres] = num;

    const q20 = this.reportData.oilQuantities['20 L'] || 0;
    const q5 = this.reportData.oilQuantities['5 L'] || 0;
    const totalLiters = (q20 * 20) + (q5 * 5);
    const hasOil = totalLiters > 0;

    // Sincronizar tarea mecánica cambio_aceite
    this.reportData.mechanicalTasks['cambio_aceite'] = hasOil;
    const taskCard = document.getElementById('task-card-cambio_aceite');
    if (taskCard) {
      taskCard.classList.toggle('checked', hasOil);
      const box = taskCard.querySelector('.task-checkbox-custom');
      if (box) box.textContent = hasOil ? '✓' : '';
    }

    // Determinar marca base desde Paso 1
    const brandName = this.getOilBrandName();

    let summaryParts = [];
    if (q20 > 0) summaryParts.push(`${q20}x 20L`);
    if (q5 > 0) summaryParts.push(`${q5}x 5L`);

    let finalOilDesc = '';
    if (summaryParts.length > 0) {
      finalOilDesc = `${brandName} (${summaryParts.join(' + ')} — ${totalLiters} L)`;
    } else {
      finalOilDesc = `${brandName} (0 L)`;
    }
    this.reportData.oilType = finalOilDesc;

    // Sincronizar selector de Paso 1 manteniendo la marca
    const oilSelect = document.getElementById('oil-type-select');
    if (oilSelect) {
      const exists = Array.from(oilSelect.options).some(o => o.value === finalOilDesc);
      if (!exists) {
        let matchingOption = Array.from(oilSelect.options).find(o => {
          if (brandName.toLowerCase().includes('ndurance')) {
            if (q20 > 0 && q5 === 0 && (o.value.includes('20') || o.text.includes('20'))) return true;
            if (q5 > 0 && q20 === 0 && (o.value.includes('5') || o.text.includes('5'))) return true;
            if (o.value.toLowerCase().includes('ndurance')) return true;
          }
          if (brandName.toLowerCase().includes('sigma')) {
            if (q20 > 0 && q5 === 0 && (o.value.includes('5GAL') || o.value.includes('5'))) return true;
            if (q5 > 0 && q20 === 0 && (o.value.includes('1GAL') || o.value.includes('1'))) return true;
            if (o.value.toLowerCase().includes('sigma')) return true;
          }
          if (brandName.toLowerCase().includes('roto-inject') && o.value.toLowerCase().includes('roto-inject')) return true;
          if (brandName.toLowerCase().includes('roto xtend')) {
            if (q20 > 0 && q5 === 0 && o.value.includes('20 L')) return true;
            if (q5 > 0 && q20 === 0 && o.value.includes('5 L')) return true;
          }
          return false;
        });

        if (matchingOption) {
          oilSelect.value = matchingOption.value;
        } else {
          const opt = document.createElement('option');
          opt.value = finalOilDesc;
          opt.textContent = finalOilDesc;
          oilSelect.appendChild(opt);
          oilSelect.value = finalOilDesc;
        }
      } else {
        oilSelect.value = finalOilDesc;
      }
    }

    if (!isDirectInput) {
      this.renderAutoLoadedPartsBox(this.reportData.maintenanceType);
    } else {
      this.updateOilCardDisplay(q20, q5, totalLiters);
    }

    this.triggerAutoSave();
  }

  adjustOilQuantity(pres, delta) {
    if (!this.reportData.oilQuantities) {
      this.reportData.oilQuantities = { '20 L': 0, '5 L': 0 };
    }
    const current = this.reportData.oilQuantities[pres] || 0;
    const nextVal = Math.max(0, current + delta);
    this.setOilQuantity(pres, nextVal, false);
  }

  applyOilPreset(q20, q5) {
    if (!this.reportData.oilQuantities) {
      this.reportData.oilQuantities = { '20 L': 0, '5 L': 0 };
    }
    this.reportData.oilQuantities['20 L'] = q20;
    this.reportData.oilQuantities['5 L'] = q5;
    this.setOilQuantity('5 L', q5, false);
    const totalLiters = (q20 * 20) + (q5 * 5);
    this.showToast(`Presentación de lubricante: ${q20 > 0 ? `${q20}x 20L ` : ''}${q5 > 0 ? `${q5}x 5L ` : ''}(${totalLiters} L total)`, 'info');
  }

  updateOilCardDisplay(q20, q5, totalLiters) {
    const titleEl = document.getElementById('oil-item-title');
    if (titleEl) {
      const brandName = this.getOilBrandName();
      titleEl.textContent = brandName;
      titleEl.title = brandName;
    }

    const totalTag = document.getElementById('oil-total-tag');
    if (totalTag) {
      totalTag.textContent = totalLiters > 0 ? `${totalLiters} L` : '0 L';
      totalTag.classList.toggle('empty', totalLiters === 0);
    }

    const sub20 = document.getElementById('oil-subtotal-20l');
    if (sub20) sub20.textContent = `${q20 * 20}L`;

    const sub5 = document.getElementById('oil-subtotal-5l');
    if (sub5) sub5.textContent = `${q5 * 5}L`;
  }

  setOilPresentation(pres) {
    if (pres.includes('20')) {
      this.applyOilPreset(1, 0);
    } else if (pres.includes('5')) {
      this.applyOilPreset(0, 1);
    }
  }

  setOilLevel(level) {
    if (!['Bajo', 'Medio', 'Alto'].includes(level)) return;
    this.reportData.oilLevel = level;
    const inputHidden = document.getElementById('field-oil-level');
    if (inputHidden) inputHidden.value = level;
    this.updateOilLevelUI(level);
    this.triggerAutoSave();
    
    let emoji = '🟢';
    if (level === 'Bajo') emoji = '🔴';
    if (level === 'Medio') emoji = '🟠';
    this.showToast(`Nivel de aceite establecido en: ${level} ${emoji}`, 'info');
  }

  updateOilLevelUI(level) {
    const hidden = document.getElementById('field-oil-level');
    if (hidden) hidden.value = level;

    // Update Step 1 buttons
    const container = document.getElementById('oil-level-selector-step1');
    if (container) {
      container.querySelectorAll('.oil-level-btn').forEach(btn => {
        if (btn.getAttribute('data-level') === level) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }
  }

  // --- AUTOCOMPLETADO INTELIGENTE DE OBSERVACIONES SEGÚN HORAS ---
  applyStandardObservation(hoursKey, force = true) {
    const text = STANDARD_OBSERVATIONS[hoursKey];
    if (!text) return false;

    const obsTextarea = document.getElementById('field-observations');
    const currentVal = (obsTextarea ? obsTextarea.value : this.reportData.observations) || '';

    // Si no es forzado, solo sobreescribir si está vacío o si ya tiene uno de los textos estándar
    const isStandard = Object.values(STANDARD_OBSERVATIONS).some(s => s.trim() === currentVal.trim());
    if (!force && currentVal.trim() !== '' && !isStandard) {
      return false; // El usuario ya escribió observaciones personalizadas
    }

    this.reportData.observations = text;
    if (obsTextarea) {
      obsTextarea.value = text;
      obsTextarea.classList.add('highlight-autofill');
      setTimeout(() => obsTextarea.classList.remove('highlight-autofill'), 1500);
    }

    const hintEl = document.getElementById('observations-autofill-hint');
    if (hintEl) {
      hintEl.textContent = `⚡ Observaciones técnicas autocompletadas según estándar de ${hoursKey} horas.`;
      hintEl.style.display = 'block';
    }

    this.triggerAutoSave();
    if (force) {
      this.showToast(`Observaciones cargadas para estándar de ${hoursKey} horas.`, 'info');
    }
    return true;
  }

  handleHoursAutocomplete(sourceValue, notify = true) {
    const key = detectHoursKey(sourceValue);
    if (!key) return;

    const applied = this.applyStandardObservation(key, false);
    if (applied && notify) {
      this.showToast(`Observaciones actualizadas automáticamente para ${key} hrs`, 'info');
    }
  }

  // --- STATE SYNCING ---
  syncFormToState() {
    const getValue = (id) => document.getElementById(id)?.value || '';

    // Step 1
    this.reportData.date = getValue('field-date') || getLocalDateString();
    this.reportData.reportNumber = getValue('field-report-number');
    this.reportData.client = getValue('field-client');
    this.reportData.equipmentId = getValue('field-equipment-id');
    this.reportData.apiCode = getValue('field-api-code');
    this.reportData.serialNumber = this.reportData.apiCode;
    this.reportData.address = getValue('field-address');
    this.reportData.technician = getValue('field-technician');
    this.reportData.serviceType = getValue('field-service-type');
    this.reportData.maintenanceType = getValue('maintenance-type-select');
    this.reportData.model = getValue('field-model');
    this.reportData.controller = getValue('field-controller');
    this.reportData.pressure = getValue('field-pressure');
    this.reportData.airflow = getValue('field-airflow');
    this.reportData.hourMeter = getValue('field-hourmeter');
    this.reportData.oilType = getValue('oil-type-select');
    this.reportData.oilLevel = getValue('field-oil-level') || this.reportData.oilLevel || 'Alto';
    this.reportData.customOil = getValue('field-custom-oil');

    // Step 2
    this.reportData.otherMechanicalTasks = getValue('field-other-tasks');
    this.reportData.pendingTasksReason = getValue('field-pending-tasks-reason');

    // Step 3
    this.reportData.hasElectrical = !!document.getElementById('has-electrical-toggle')?.checked;
    this.reportData.electrical.u1_u2 = getValue('elec-u1-u2');
    this.reportData.electrical.u2_u3 = getValue('elec-u2-u3');
    this.reportData.electrical.u1_u3 = getValue('elec-u1-u3');
    this.reportData.electrical.i_l1 = getValue('elec-i-l1');
    this.reportData.electrical.i_l2 = getValue('elec-i-l2');
    this.reportData.electrical.i_l3 = getValue('elec-i-l3');
    this.reportData.electrical.f1 = getValue('elec-f1');
    this.reportData.electrical.f2 = getValue('elec-f2');
    this.reportData.electrical.f3 = getValue('elec-f3');
    this.reportData.electrical.ground = getValue('elec-ground');

    this.reportData.mainMotor.brand = getValue('motor-brand');
    this.reportData.mainMotor.voltage = getValue('motor-voltage');
    this.reportData.mainMotor.amperage = getValue('motor-amperage');
    this.reportData.mainMotor.fs = getValue('motor-fs');
    this.reportData.mainMotor.protection = getValue('motor-protection');

    this.reportData.fanMotor.voltage = getValue('fan-voltage');
    this.reportData.fanMotor.amperage = getValue('fan-amperage');
    this.reportData.fanMotor.fs = getValue('fan-fs');
    this.reportData.fanMotor.protection = getValue('fan-protection');

    // Step 4
    this.reportData.hasDryer = !!document.getElementById('has-dryer-toggle')?.checked;
    this.reportData.dryer.model = getValue('dryer-model');
    this.reportData.dryer.serialNumber = getValue('dryer-serial');
    this.reportData.dryer.dewPoint = getValue('dryer-dewpoint');
    this.reportData.dryer.voltage = getValue('dryer-voltage');
    this.reportData.dryer.amperage = getValue('dryer-amperage');
    this.reportData.dryer.protection = getValue('dryer-protection');
    this.reportData.dryer.cleaning = getValue('dryer-cleaning');
    this.reportData.dryer.refrigerant = getValue('dryer-refrigerant');

    // Step 5
    this.reportData.serviceLives.oilLife = getValue('life-oil');
    this.reportData.serviceLives.oilFilterLife = getValue('life-oil-filter');
    this.reportData.serviceLives.airFilterLife = getValue('life-air-filter');
    this.reportData.serviceLives.separatorLife = getValue('life-separator');
    this.reportData.serviceLives.motorGreaseLife = getValue('life-grease');

    this.reportData.regulations.loadPressure = getValue('reg-load-press');
    this.reportData.regulations.unloadPressure = getValue('reg-unload-press');
    this.reportData.regulations.vsdSetpoint = getValue('reg-vsd');
    this.reportData.regulations.startsCount = getValue('reg-starts');
    this.reportData.regulations.loadDelay = getValue('reg-delay');

    this.reportData.technicalParameters.elem1Temp = getValue('param-temp-elem1');
    this.reportData.technicalParameters.elem2Temp = getValue('param-temp-elem2');
    this.reportData.technicalParameters.oilTemp = getValue('param-temp-oil');
    this.reportData.technicalParameters.airPressure = getValue('param-air-press');
    this.reportData.technicalParameters.intermediatePressure = getValue('param-inter-press');

    // Step 6
    this.reportData.observations = getValue('field-observations');
    this.reportData.recommendations = getValue('field-recommendations');

    // Step 8: Signatures
    if (this.techSigPad) {
      this.reportData.techSignature = this.techSigPad.isEmpty() ? null : this.techSigPad.toDataURL();
    }
    this.reportData.techName = getValue('field-tech-name') || this.reportData.technician;

    if (this.clientSigPad) {
      this.reportData.clientSignature = this.clientSigPad.isEmpty() ? null : this.clientSigPad.toDataURL();
    }
    this.reportData.clientSignerName = getValue('field-client-signer-name');
    this.reportData.clientSignerPosition = getValue('field-client-signer-pos');
  }

  syncStateToForm() {
    // Clean up any rogue numeric alias options from maintenance-type-select
    const maintSelect = document.getElementById('maintenance-type-select');
    if (maintSelect) {
      Array.from(maintSelect.options).forEach(opt => {
        if (/^\d+\s*horas?$/i.test(opt.value.trim())) {
          opt.remove();
        }
      });
    }

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) {
        if (el.tagName === 'SELECT' && val) {
          if (id === 'maintenance-type-select') {
            val = this.normalizeMaintenanceType(val);
          }
          const exists = Array.from(el.options).some(opt => opt.value === val);
          if (!exists) {
            if (id !== 'maintenance-type-select') {
              const opt = document.createElement('option');
              opt.value = val;
              opt.textContent = val;
              el.appendChild(opt);
            }
          }
        }
        el.value = val || '';
      }
    };

    const resolvedDate = this.reportData.date || getLocalDateString();
    this.reportData.date = resolvedDate;
    setVal('field-date', resolvedDate);
    setVal('field-report-number', this.reportData.reportNumber);
    setVal('field-client', this.reportData.client);
    setVal('field-equipment-id', this.reportData.equipmentId);
    setVal('field-api-code', this.reportData.apiCode || this.reportData.serialNumber);
    setVal('field-address', this.reportData.address);
    setVal('field-technician', this.reportData.technician);
    setVal('field-service-type', this.reportData.serviceType);
    this.reportData.maintenanceType = this.normalizeMaintenanceType(this.reportData.maintenanceType);
    setVal('maintenance-type-select', this.reportData.maintenanceType);
    setVal('field-model', this.reportData.model);
    setVal('field-controller', this.reportData.controller);
    setVal('field-pressure', this.reportData.pressure);
    setVal('field-airflow', this.reportData.airflow);
    setVal('field-hourmeter', this.reportData.hourMeter);
    setVal('oil-type-select', this.reportData.oilType);
    setVal('field-custom-oil', this.reportData.customOil);
    this.updateOilLevelUI(this.reportData.oilLevel || 'Alto');
    this.syncReportEquipmentSelects();

    if (this.customOilGroup) {
      this.customOilGroup.style.display = this.reportData.oilType === 'Otro' ? 'flex' : 'none';
    }

    // Step 2
    setVal('field-other-tasks', this.reportData.otherMechanicalTasks);
    setVal('field-pending-tasks-reason', this.reportData.pendingTasksReason);
    this.renderMechanicalTasksList();

    // Step 3
    const hasElec = !!(
      this.reportData.hasElectrical ||
      (this.reportData.hasElectrical !== false && (
        (this.reportData.electrical && (this.reportData.electrical.u1_u2 || this.reportData.electrical.i_l1 || this.reportData.electrical.ground)) ||
        (this.reportData.mainMotor && (this.reportData.mainMotor.brand || this.reportData.mainMotor.voltage))
      ))
    );
    this.reportData.hasElectrical = hasElec;
    if (this.electricalToggle) this.electricalToggle.checked = hasElec;
    if (this.electricalFieldsSection) {
      this.electricalFieldsSection.style.display = hasElec ? 'block' : 'none';
    }
    if (this.noElectricalNotice) {
      this.noElectricalNotice.style.display = hasElec ? 'none' : 'block';
    }

    setVal('elec-u1-u2', this.reportData.electrical.u1_u2);
    setVal('elec-u2-u3', this.reportData.electrical.u2_u3);
    setVal('elec-u1-u3', this.reportData.electrical.u1_u3);
    setVal('elec-i-l1', this.reportData.electrical.i_l1);
    setVal('elec-i-l2', this.reportData.electrical.i_l2);
    setVal('elec-i-l3', this.reportData.electrical.i_l3);
    setVal('elec-f1', this.reportData.electrical.f1);
    setVal('elec-f2', this.reportData.electrical.f2);
    setVal('elec-f3', this.reportData.electrical.f3);
    setVal('elec-ground', this.reportData.electrical.ground);

    setVal('motor-brand', this.reportData.mainMotor.brand);
    setVal('motor-voltage', this.reportData.mainMotor.voltage);
    setVal('motor-amperage', this.reportData.mainMotor.amperage);
    setVal('motor-fs', this.reportData.mainMotor.fs);
    setVal('motor-protection', this.reportData.mainMotor.protection);

    setVal('fan-voltage', this.reportData.fanMotor.voltage);
    setVal('fan-amperage', this.reportData.fanMotor.amperage);
    setVal('fan-fs', this.reportData.fanMotor.fs);
    setVal('fan-protection', this.reportData.fanMotor.protection);

    // Step 4
    if (this.dryerToggle) this.dryerToggle.checked = !!this.reportData.hasDryer;
    if (this.dryerFieldsSection) {
      this.dryerFieldsSection.style.display = this.reportData.hasDryer ? 'block' : 'none';
    }
    setVal('dryer-model', this.reportData.dryer.model);
    setVal('dryer-serial', this.reportData.dryer.serialNumber);
    setVal('dryer-dewpoint', this.reportData.dryer.dewPoint);
    setVal('dryer-voltage', this.reportData.dryer.voltage);
    setVal('dryer-amperage', this.reportData.dryer.amperage);
    setVal('dryer-protection', this.reportData.dryer.protection);
    setVal('dryer-cleaning', this.reportData.dryer.cleaning);
    setVal('dryer-refrigerant', this.reportData.dryer.refrigerant);

    // Step 5
    setVal('life-oil', this.reportData.serviceLives.oilLife);
    setVal('life-oil-filter', this.reportData.serviceLives.oilFilterLife);
    setVal('life-air-filter', this.reportData.serviceLives.airFilterLife);
    setVal('life-separator', this.reportData.serviceLives.separatorLife);
    setVal('life-grease', this.reportData.serviceLives.motorGreaseLife);

    setVal('reg-load-press', this.reportData.regulations.loadPressure);
    setVal('reg-unload-press', this.reportData.regulations.unloadPressure);
    setVal('reg-vsd', this.reportData.regulations.vsdSetpoint);
    setVal('reg-starts', this.reportData.regulations.startsCount);
    setVal('reg-delay', this.reportData.regulations.loadDelay);

    setVal('param-temp-elem1', this.reportData.technicalParameters.elem1Temp);
    setVal('param-temp-elem2', this.reportData.technicalParameters.elem2Temp);
    setVal('param-temp-oil', this.reportData.technicalParameters.oilTemp);
    setVal('param-air-press', this.reportData.technicalParameters.airPressure);
    setVal('param-inter-press', this.reportData.technicalParameters.intermediatePressure);

    // Step 6
    setVal('field-observations', this.reportData.observations);
    setVal('field-recommendations', this.reportData.recommendations);

    // Step 7: Photos
    if (this.photoManager) {
      this.photoManager.setPhotos(this.reportData.photos || []);
    }

    // Step 8: Signatures
    setVal('field-tech-name', this.reportData.techName || this.reportData.technician);
    setVal('field-client-signer-name', this.reportData.clientSignerName);
    setVal('field-client-signer-pos', this.reportData.clientSignerPosition);

    if (this.techSigPad) {
      if (this.reportData.techSignature) {
        this.techSigPad.loadFromDataURL(this.reportData.techSignature);
      } else {
        this.techSigPad.clear();
      }
    }
    if (this.clientSigPad) {
      if (this.reportData.clientSignature) {
        this.clientSigPad.loadFromDataURL(this.reportData.clientSignature);
      } else {
        this.clientSigPad.clear();
      }
    }
  }

  // --- PERSISTENCE & AUTOSAVE ---
  triggerAutoSave() {
    clearTimeout(this.autosaveDebounce);
    this.autosaveDebounce = setTimeout(() => {
      this.saveDraft(false);
    }, 1200);
  }

  async saveDraft(showToast = true) {
    this.syncFormToState();
    this.reportData.draftSavedOn = getLocalDateString();
    this.reportData.status = this.reportData.status === 'Finalizado' ? 'Finalizado' : 'Borrador';

    // Local storage instant cache
    try {
      localStorage.setItem('industrac_active_draft', JSON.stringify(this.reportData));
    } catch (e) {
      console.warn('LocalStorage lleno para fotos grandes:', e);
    }

    // Server persistence
    try {
      let res;
      if (this.reportData.id) {
        res = await fetch(`/api/reports/${this.reportData.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.reportData)
        });
        if (!res.ok && (res.status === 404 || res.status === 400)) {
          // Si PUT falla por ID inexistente en el servidor, reintentar con POST
          console.warn(`PUT /api/reports/${this.reportData.id} devolvió ${res.status}. Reintentando vía POST...`);
          res = await fetch('/api/reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.reportData)
          });
        }
      } else {
        res = await fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.reportData)
        });
      }

      if (res.ok) {
        const saved = await res.json();
        this.reportData.id = saved.id;
        this.reportData.reportNumber = saved.reportNumber;
        document.getElementById('field-report-number').value = saved.reportNumber;

        this.updateSyncStatus('Guardado en servidor');
        if (showToast) this.showToast('Borrador guardado exitosamente en el servidor.', 'success');
        return true;
      } else {
        this.updateSyncStatus('Guardado localmente');
        return false;
      }
    } catch (err) {
      this.updateSyncStatus('Modo Offline (Guardado local)');
      if (showToast) this.showToast('Borrador guardado en la memoria de este dispositivo.', 'info');
      return false;
    }
  }

  updateSyncStatus(text) {
    const el = document.getElementById('sync-status-indicator');
    if (el) el.innerHTML = `<span class="status-dot"></span> ${text}`;
  }

  async restoreOrCreateDraft() {
    const today = getLocalDateString();

    // 1. Fetch fresh next correlative from server
    let freshNextNumber = 'REP-2026-0001';
    try {
      const res = await fetch('/api/next-report-number?peek=true');
      if (res.ok) {
        const data = await res.json();
        if (data.reportNumber) freshNextNumber = data.reportNumber;
      }
    } catch (e) {
      console.warn('Error obteniendo siguiente correlativo:', e);
    }

    // 2. Check localStorage
    const saved = localStorage.getItem('industrac_active_draft');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && (parsed.client || parsed.equipmentId)) {
          // Verify if this draft's reportNumber was already finalized or is an outdated sequence
          const serverReport = this.reports && this.reports.find(r => (parsed.id && r.id === parsed.id) || r.reportNumber === parsed.reportNumber);
          const isAlreadyFinalized = serverReport && serverReport.status === 'Finalizado';
          const isOutdatedDraft = !serverReport && parsed.reportNumber !== freshNextNumber;
          const isInvalidNumber = !parsed.reportNumber || parsed.reportNumber === 'AUTO' || isAlreadyFinalized || isOutdatedDraft || parsed.status === 'Finalizado';

          if (isInvalidNumber) {
            // Assign fresh correlative and start as unfinalized draft
            parsed.reportNumber = freshNextNumber;
            parsed.id = null;
            parsed.status = 'Borrador';
          }

          // If the draft was saved on an earlier day or has an old date, update date to today automatically
          if (!parsed.draftSavedOn || parsed.draftSavedOn !== today || !parsed.date || parsed.date !== today) {
            parsed.date = today;
          }
          parsed.draftSavedOn = today;
          if (parsed.maintenanceType) {
            parsed.maintenanceType = this.normalizeMaintenanceType(parsed.maintenanceType);
          }
          this.reportData = parsed;
          this.syncStateToForm();
          const numInput = document.getElementById('field-report-number');
          if (numInput) numInput.value = this.reportData.reportNumber;
          this.showToast(`Borrador activo: Correlativo N° ${this.reportData.reportNumber}`, 'info');
          return;
        }
      } catch (e) {
        console.warn('Error leyendo borrador local:', e);
      }
    }

    // 3. Default suggestions for fresh report
    this.reportData = this.getEmptyReport();
    this.reportData.reportNumber = freshNextNumber;
    this.reportData.date = today;
    this.syncStateToForm();
    const numInput = document.getElementById('field-report-number');
    if (numInput) numInput.value = freshNextNumber;
    this.suggestMechanicalTasks('Plan A — 2000 horas');
  }

  async startNewReport() {
    if (confirm('¿Desea iniciar un nuevo reporte? Asegúrese de haber guardado el actual.')) {
      localStorage.removeItem('industrac_active_draft');
      this.reportData = this.getEmptyReport();
      this.syncStateToForm();
      if (this.techSigPad) this.techSigPad.clear();
      if (this.clientSigPad) this.clientSigPad.clear();
      if (this.photoManager) this.photoManager.setPhotos([]);
      this.goToStep(1);
      this.switchTab('tab-report');
      await this.restoreOrCreateDraft();
    }
  }

  // --- REVIEW SUMMARY (STEP 9) ---
  renderReviewSummary() {
    const container = document.getElementById('review-summary-content');
    if (!container) return;

    this.syncFormToState();

    const executedCount = Object.values(this.reportData.mechanicalTasks || {}).filter(Boolean).length;
    const photosCount = (this.reportData.photos || []).length;
    const hasTechSig = !!this.reportData.techSignature;
    const hasClientSig = !!this.reportData.clientSignature;

    container.innerHTML = `
      <div class="review-summary-grid">
        <!-- Card 1: General -->
        <div class="review-section-card">
          <div class="review-section-header">
            <h4>1. Datos Generales & Equipo</h4>
            <button class="btn-edit-step" onclick="window.app.goToStep(1)">Editar</button>
          </div>
          <div class="review-row"><span class="label">N° Reporte:</span><span class="val">${this.reportData.reportNumber}</span></div>
          <div class="review-row"><span class="label">Cliente:</span><span class="val">${this.reportData.client || 'Sin especificar'}</span></div>
          <div class="review-row"><span class="label">Fecha:</span><span class="val">${this.reportData.date}</span></div>
          <div class="review-row"><span class="label">Técnico:</span><span class="val">${this.reportData.technician || 'Sin especificar'}</span></div>
          <div class="review-row"><span class="label">Compresor:</span><span class="val">${this.reportData.model || 'N/A'} (API/ID: ${this.reportData.apiCode || this.reportData.serialNumber || 'N/A'})</span></div>
          <div class="review-row"><span class="label">Mantenimiento:</span><span class="val">${this.reportData.maintenanceType}</span></div>
          <div class="review-row"><span class="label">Horómetro:</span><span class="val">${this.reportData.hourMeter || '0'} hrs</span></div>
          <div class="review-row"><span class="label">Aceite:</span><span class="val">${this.reportData.oilType}</span></div>
          <div class="review-row">
            <span class="label">Nivel de Aceite:</span>
            <span class="val">
              <span class="badge-oil-level ${(this.reportData.oilLevel || 'Alto').toLowerCase()}">
                ● ${this.reportData.oilLevel || 'Alto'}
              </span>
            </span>
          </div>
        </div>

        <!-- Card 2: Trabajos Mecánicos -->
        <div class="review-section-card">
          <div class="review-section-header">
            <h4>2. Trabajos Mecánicos</h4>
            <button class="btn-edit-step" onclick="window.app.goToStep(2)">Editar</button>
          </div>
          <div class="review-row"><span class="label">Tareas Ejecutadas:</span><span class="val">${executedCount} tareas realizadas</span></div>
          <div class="review-row"><span class="label">Trabajos Adicionales:</span><span class="val">${this.reportData.otherMechanicalTasks ? 'Registrados' : 'Ninguno'}</span></div>
          <div class="review-row"><span class="label">Justificación Pendientes:</span><span class="val">${this.reportData.pendingTasksReason ? 'Registrada' : 'Sin pendientes'}</span></div>
        </div>

        <!-- Card 3: Mediciones & Motores -->
        <div class="review-section-card">
          <div class="review-section-header">
            <h4>3. Mediciones Eléctricas</h4>
            <button class="btn-edit-step" onclick="window.app.goToStep(3)">Editar</button>
          </div>
          ${this.reportData.hasElectrical ? `
          <div class="review-row"><span class="label">Voltajes (UL1-UL2):</span><span class="val">${this.reportData.electrical.u1_u2 || 'N/M'} V</span></div>
          <div class="review-row"><span class="label">Amperajes (L1, L2, L3):</span><span class="val">${this.reportData.electrical.i_l1 || 'N/M'} / ${this.reportData.electrical.i_l2 || 'N/M'} / ${this.reportData.electrical.i_l3 || 'N/M'} A</span></div>
          <div class="review-row"><span class="label">Motor Principal:</span><span class="val">${this.reportData.mainMotor.brand || 'N/A'} (${this.reportData.mainMotor.voltage || 'N/M'}V)</span></div>
          <div class="review-row"><span class="label">Motor Ventilador:</span><span class="val">${this.reportData.fanMotor.voltage || 'N/M'}V / ${this.reportData.fanMotor.amperage || 'N/M'}A</span></div>
          ` : `
          <div class="review-row"><span class="label">Estado:</span><span class="val" style="color: #64748B;">No aplica / Omitido en este servicio</span></div>
          `}
        </div>

        <!-- Card 4: Secador & Parámetros -->
        <div class="review-section-card">
          <div class="review-section-header">
            <h4>4 & 5. Secador & Parámetros</h4>
            <button class="btn-edit-step" onclick="window.app.goToStep(4)">Editar</button>
          </div>
          <div class="review-row"><span class="label">Secador Incluido:</span><span class="val">${this.reportData.hasDryer ? `Sí (${this.reportData.dryer.model})` : 'No aplica'}</span></div>
          <div class="review-row"><span class="label">Temp. Salida Elemento 1:</span><span class="val">${this.reportData.technicalParameters.elem1Temp || 'N/M'} °C</span></div>
          <div class="review-row"><span class="label">Temp. Aceite:</span><span class="val">${this.reportData.technicalParameters.oilTemp || 'N/M'} °C</span></div>
          <div class="review-row"><span class="label">Presión Aire Carga:</span><span class="val">${this.reportData.regulations.loadPressure || 'N/M'} bar</span></div>
        </div>

        <!-- Card 5: Evidencias & Firmas -->
        <div class="review-section-card">
          <div class="review-section-header">
            <h4>7 & 8. Fotos y Firmas</h4>
            <div style="display: flex; gap: 0.5rem;">
              <button class="btn-edit-step" onclick="window.app.goToStep(7)" title="Editar fotos">Fotos</button>
              <button class="btn-edit-step" onclick="window.app.goToStep(8)" title="Editar firmas">Firmas</button>
            </div>
          </div>
          <div class="review-row"><span class="label">Fotografías Adjuntas:</span><span class="val">${photosCount} foto(s)</span></div>
          <div class="review-row">
            <span class="label">Firma Técnico:</span>
            <span class="val" style="color:${hasTechSig ? 'green' : 'red'}; font-weight: 600;">
              ${hasTechSig ? '✓ Firmado' : '✗ Pendiente'}
              <span style="color:var(--color-text-muted); font-size:0.8rem; font-weight:normal;"> (${this.reportData.techName || this.reportData.technician || 'Sin asignar'})</span>
            </span>
          </div>
          <div class="review-row">
            <span class="label">Firma Cliente:</span>
            <span class="val" style="color:${hasClientSig ? 'green' : 'red'}; font-weight: 600;">
              ${hasClientSig ? '✓ Firmado' : '✗ Pendiente'}
              <span style="color:var(--color-text-muted); font-size:0.8rem; font-weight:normal;"> (${this.reportData.clientSignerName || 'Representante'})</span>
            </span>
          </div>
        </div>
      </div>
    `;
  }

  // Generador de nombre estandarizado de archivo PDF:
  // REP-(CLIENTE)-(MODELO DE COMPRESOR)-(TIPO DE MANTENIMIENTO)-(FECHA)
  generateReportPdfFileName(report) {
    if (!report) return 'REP-REPORTE.pdf';

    const sanitize = (str) => {
      if (!str) return '';
      return String(str)
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/[\r\n\t]/g, ' ')
        .replace(/[—–]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const client = sanitize(report.client) || 'CLIENTE';
    const model = sanitize(report.model) || 'MODELO';
    const maint = sanitize(report.maintenanceType || report.serviceType) || 'MANTENIMIENTO';

    let dateStr = '';
    if (report.date) {
      const raw = String(report.date).split('T')[0].trim();
      const parts = raw.split('-');
      if (parts.length === 3) {
        dateStr = parts.join('-');
      } else {
        dateStr = sanitize(report.date).replace(/[\/]/g, '-');
      }
    }
    if (!dateStr) {
      dateStr = new Date().toISOString().split('T')[0];
    }

    return `REP-${client}-${model}-${maint}-${dateStr}.pdf`;
  }

  // --- FINALIZACIÓN Y GENERACIÓN PDF ---
  async finalizeReport() {
    this.syncFormToState();

    // Check mandatory client field
    if (!this.reportData.client) {
      this.showToast('El campo Cliente es requerido antes de finalizar el reporte.', 'error');
      this.goToStep(1);
      return;
    }

    // Check mandatory hourMeter field
    const rawHours = String(this.reportData.hourMeter || '').trim();
    if (!rawHours || isNaN(Number(rawHours)) || Number(rawHours) < 0) {
      this.showToast('El Horómetro Total es obligatorio y debe ser un número válido mayor o igual a 0.', 'error');
      this.goToStep(1);
      const hInput = document.getElementById('field-hourmeter');
      if (hInput) {
        hInput.focus();
        hInput.classList.add('input-error');
        setTimeout(() => hInput.classList.remove('input-error'), 3000);
      }
      return;
    }

    if (!this.reportData.techSignature && !this.reportData.clientSignature) {
      this.showToast('Nota: El reporte se emitirá sin firmas registradas.', 'warning');
    }

    try {
      this.showToast('Finalizando reporte y asegurando correlativo...', 'info');

      // 1. Ensure report has a valid non-AUTO correlative number
      if (!this.reportData.reportNumber || this.reportData.reportNumber === 'AUTO') {
        const nextRes = await fetch('/api/next-report-number?peek=false');
        const nextData = await nextRes.json();
        this.reportData.reportNumber = nextData.reportNumber;
        const numInput = document.getElementById('field-report-number');
        if (numInput) numInput.value = this.reportData.reportNumber;
      }

      // 2. Mark as Finalizado
      this.reportData.status = 'Finalizado';

      // 3. Persist metadata to server first and guarantee correlativo synchronization
      let savedOk = await this.saveDraft(false);
      if (!savedOk) {
        console.warn('Primer intento de guardado no confirmado en servidor. Reintentando vía POST directo...');
        this.reportData.id = null;
        savedOk = await this.saveDraft(false);
      }
      if (!savedOk) {
        this.showToast('Aviso: El reporte no pudo sincronizarse con el servidor. Se generará el PDF localmente.', 'warning');
      }

      // Verify confirmed report number
      const confirmedNumber = (this.reportData.reportNumber && this.reportData.reportNumber !== 'AUTO') 
        ? this.reportData.reportNumber 
        : 'REP-2026-0001';
      this.reportData.reportNumber = confirmedNumber;

      // 4. Update data on all views immediately so Horómetros and Historial reflect confirmed persistence
      await this.loadReports();
      await this.loadHorometersData();
      await this.loadEquipments();

      this.showToast(`Generando PDF oficial para ${confirmedNumber}...`, 'info');

      // 5. Generate high-fidelity PDF with the verified correlative
      const doc = await this.pdfGen.generatePdf(this.reportData);

      // 6. Download file safely across all browsers & upload to Google Drive
      const fileName = this.generateReportPdfFileName(this.reportData);
      await this.triggerFileDownload(doc, fileName, this.reportData.id);

      this.showToast(`¡Reporte ${confirmedNumber} generado exitosamente!`, 'success');

      // Clear draft cache once finalized
      localStorage.removeItem('industrac_active_draft');
    } catch (err) {
      console.error('Error generando PDF:', err);
      this.showToast('Error al generar el documento PDF: ' + err.message, 'error');
    }
  }

  // Universal download trigger: Direct anchor + Server storage + Dedicated modal
  async triggerFileDownload(doc, fileName, reportId) {
    const blob = doc.output('blob');
    const blobUrl = URL.createObjectURL(blob);
    const pdfBase64 = doc.output('datauristring');

    // 1. Upload to server asynchronously for permanent link & Google Drive backup
    if (reportId) {
      const cleanBase64 = pdfBase64.includes('base64,') ? pdfBase64.split('base64,')[1].trim() : pdfBase64.trim();
      let driveLinked = false;

      fetch(`/api/reports/${reportId}/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfBase64, fileName })
      })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (data && (data.driveDownloadUrl || data.driveUrl)) {
          driveLinked = true;
          const driveBtn = document.getElementById('btn-modal-drive-link');
          if (driveBtn) {
            driveBtn.href = data.driveDownloadUrl || data.driveUrl;
            driveBtn.style.display = 'inline-flex';
          }
          this.showToast('☁️ PDF enlazado a Google Drive (PDF_REPORTES2027)', 'success');
        } else {
          throw new Error('Servidor no devolvió URL de Drive');
        }
      })
      .catch(err => {
        console.warn('Aviso: el servidor no pudo sincronizar a Drive, activando canal directo cliente-Drive:', err);
        // Canal de respaldo directo desde el navegador hacia Google Apps Script (inmune a límites de servidor o Vercel)
        if (!driveLinked) {
          const directWebhook = 'https://script.google.com/macros/s/AKfycbynhuCRqkjdVzK0sEeQCdbeHMFwcMj6PLqDW6Cme2wOcNRo4ZuaoTEe7a_54GZG2L6U/exec';
          const repNum = this.reportData.reportNumber || reportId;
          fetch(directWebhook, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
              action: 'upload_pdf_drive',
              folderName: 'PDF_REPORTES2027',
              reportId: reportId,
              reportNumber: repNum,
              fileName: fileName,
              pdfBase64: cleanBase64
            })
          })
          .then(() => {
            console.log('[Google Drive] Respaldo directo enviado a la carpeta PDF_REPORTES2027.');
            this.showToast('☁️ PDF enviado a Google Drive (PDF_REPORTES2027)', 'success');
          })
          .catch(eDirect => console.warn('[Google Drive] Error en respaldo directo:', eDirect));
        }
      });
    }

    // 2. Direct browser download trigger via DOM anchor
    try {
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = blobUrl;
      a.download = fileName;
      a.setAttribute('download', fileName);
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 2000);
    } catch (err) {
      console.warn('Descarga automática directa no permitida por navegador:', err);
    }

    // 3. Open Success Modal with direct user-clickable links & embedded preview
    this.showDownloadSuccessModal(blobUrl, fileName, reportId);
  }

  showDownloadSuccessModal(blobUrl, fileName, reportId) {
    const modal = document.getElementById('pdf-download-success-modal');
    const sub = document.getElementById('download-modal-subtitle');
    const details = document.getElementById('download-modal-details');
    const dlBtn = document.getElementById('btn-modal-direct-download');
    const driveBtn = document.getElementById('btn-modal-drive-link');
    const tabBtn = document.getElementById('btn-modal-open-tab');
    const iframe = document.getElementById('pdf-download-iframe');

    const repNum = this.reportData.reportNumber || 'REP-2026';
    const clientName = this.reportData.client || 'Sin Cliente';

    if (sub) {
      sub.textContent = `Reporte N° ${repNum} — ${clientName}`;
    }

    if (details) {
      details.innerHTML = `El reporte <strong>${repNum}</strong> fue guardado correctamente con estado <strong>Finalizado</strong> para <strong>${clientName}</strong>. Documento PDF disponible a continuación:`;
    }

    if (dlBtn) {
      // Use both blob URL and server endpoint fallback
      dlBtn.href = blobUrl;
      dlBtn.download = fileName;
      dlBtn.onclick = () => {
        // Fallback to server endpoint if blob download is restricted
        setTimeout(() => {
          if (reportId) window.location.href = `/api/reports/${reportId}/pdf`;
        }, 1500);
      };
    }

    if (driveBtn) {
      const driveUrl = this.reportData.pdfDriveDownloadUrl || this.reportData.pdfDriveUrl;
      if (driveUrl) {
        driveBtn.href = driveUrl;
        driveBtn.style.display = 'inline-flex';
      } else {
        driveBtn.style.display = 'none';
      }
    }

    if (tabBtn) {
      tabBtn.href = blobUrl;
    }

    if (iframe) {
      iframe.src = blobUrl;
    }

    if (modal) {
      modal.classList.add('active');
    }
  }

  closeDownloadSuccessModal() {
    const modal = document.getElementById('pdf-download-success-modal');
    if (modal) modal.classList.remove('active');
  }

  async startNewReportFromSuccessModal() {
    this.closeDownloadSuccessModal();
    localStorage.removeItem('industrac_active_draft');
    this.reportData = this.getEmptyReport();
    this.syncStateToForm();
    if (this.techSigPad) this.techSigPad.clear();
    if (this.clientSigPad) this.clientSigPad.clear();
    if (this.photoManager) this.photoManager.setPhotos([]);
    this.goToStep(1);
    this.switchTab('tab-report');
    await this.restoreOrCreateDraft();
    this.showToast(`¡Nuevo reporte iniciado! Correlativo asignado: ${this.reportData.reportNumber}`, 'success');
  }

  async previewReportPdf() {
    try {
      this.syncFormToState();
      this.showToast('Preparando vista previa del PDF...', 'info');
      const doc = await this.pdfGen.generatePdf(this.reportData);
      const pdfBlob = doc.output('blob');
      const blobUrl = URL.createObjectURL(pdfBlob);

      const modal = document.getElementById('pdf-preview-modal');
      const iframe = document.getElementById('pdf-preview-iframe');
      if (modal && iframe) {
        iframe.src = blobUrl;
        modal.classList.add('active');
      }
    } catch (err) {
      this.showToast('Error preparando vista previa: ' + err.message, 'error');
    }
  }

  closePreviewModal() {
    const modal = document.getElementById('pdf-preview-modal');
    if (modal) modal.classList.remove('active');
  }

  // --- HISTORIAL DE REPORTES ---
  renderHistoryTable(filteredReports = null) {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;

    const list = filteredReports || this.reports;

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; padding: 2rem; color: #94A3B8;">
            No se encontraron reportes registrados.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = list.map(rep => {
      let badgeClass = 'badge-finalized';
      if (rep.status === 'Borrador') badgeClass = 'badge-draft';
      if (rep.status === 'Pendiente de revisión') badgeClass = 'badge-pending';

      return `
        <tr>
          <td><strong>${rep.reportNumber}</strong></td>
          <td>${rep.date ? this.formatDateSpanish(rep.date) : 'N/A'}</td>
          <td>${rep.client || 'Sin cliente'}</td>
          <td>${rep.model || 'N/A'}</td>
          <td><code>${rep.apiCode || rep.serialNumber || 'N/A'}</code></td>
          <td>${rep.technician || 'N/A'}</td>
          <td>${rep.maintenanceType || 'Plan A — 2000 horas'}</td>
          <td><span class="badge ${badgeClass}">${rep.status}</span></td>
          <td>
            <div style="display: flex; gap: 0.35rem; align-items: center;">
              <button class="btn btn-sm btn-outline-accent" title="Descargar PDF" onclick="window.app.downloadReportPdf('${rep.id}')">
                PDF
              </button>
              ${rep.pdfDriveDownloadUrl || rep.pdfDriveUrl ? `
                <a href="${rep.pdfDriveDownloadUrl || rep.pdfDriveUrl}" target="_blank" class="btn btn-sm btn-outline-success" title="Descargar desde Google Drive (PDF_REPORTES2027)" style="text-decoration: none; padding: 0.2rem 0.45rem;">
                  ☁️
                </a>
              ` : ''}
              <button class="btn btn-sm btn-secondary" title="Editar / Ver" onclick="window.app.editReport('${rep.id}')">
                ✏️
              </button>
              <button class="btn btn-sm btn-secondary" title="Duplicar para nuevo servicio" onclick="window.app.duplicateReport('${rep.id}')">
                📋
              </button>
              <button class="btn btn-sm btn-danger" title="Eliminar" onclick="window.app.deleteReport('${rep.id}')">
                ✕
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  filterHistory() {
    const query = (document.getElementById('search-history-input')?.value || '').toLowerCase();
    const statusFilter = document.getElementById('filter-history-status')?.value || '';

    const filtered = this.reports.filter(r => {
      const matchQuery = !query ||
        (r.reportNumber || '').toLowerCase().includes(query) ||
        (r.client || '').toLowerCase().includes(query) ||
        (r.model || '').toLowerCase().includes(query) ||
        (r.technician || '').toLowerCase().includes(query) ||
        (r.serialNumber || '').toLowerCase().includes(query);

      const matchStatus = !statusFilter || r.status === statusFilter;
      return matchQuery && matchStatus;
    });

    this.renderHistoryTable(filtered);
  }

  async downloadReportPdf(reportId) {
    try {
      const rep = this.reports.find(r => r.id === reportId);
      if (!rep) return;

      this.showToast('Preparando descarga del reporte...', 'info');
      const doc = await this.pdfGen.generatePdf(rep);
      const fileName = this.generateReportPdfFileName(rep);
      await this.triggerFileDownload(doc, fileName, rep.id);
    } catch (e) {
      this.showToast('Error descargando PDF: ' + e.message, 'error');
    }
  }

  editReport(reportId) {
    const rep = this.reports.find(r => r.id === reportId);
    if (!rep) return;

    this.reportData = JSON.parse(JSON.stringify(rep));
    this.syncStateToForm();
    this.switchTab('tab-report');
    this.goToStep(1);
    this.showToast(`Editando reporte ${rep.reportNumber}`, 'info');
  }

  async duplicateReport(reportId) {
    const rep = this.reports.find(r => r.id === reportId);
    if (!rep) return;

    // Fetch next number
    let newNumber = 'AUTO';
    try {
      const res = await fetch('/api/next-report-number?peek=true');
      const data = await res.json();
      newNumber = data.reportNumber;
    } catch (e) {}

    const cloned = JSON.parse(JSON.stringify(rep));
    cloned.id = null;
    cloned.reportNumber = newNumber;
    cloned.date = getLocalDateString();
    cloned.status = 'Borrador';
    cloned.techSignature = null;
    cloned.clientSignature = null;
    cloned.photos = [];

    this.reportData = cloned;
    this.syncStateToForm();
    if (this.techSigPad) this.techSigPad.clear();
    if (this.clientSigPad) this.clientSigPad.clear();
    if (this.photoManager) this.photoManager.setPhotos([]);

    this.switchTab('tab-report');
    this.goToStep(1);
    this.showToast(`Reporte duplicado como nuevo borrador (${newNumber})`, 'success');
  }

  async deleteReport(reportId) {
    if (!reportId) return;
    if (this._isDeletingReport) return;

    const rep = this.reports.find(r => r.id === reportId || r.reportNumber === reportId);
    const repDisplay = rep ? `${rep.reportNumber || 'Reporte'} (${rep.client || 'Cliente'})` : `Reporte ${reportId}`;

    const confirmed = await this.showConfirmModal({
      title: 'Eliminar Reporte Técnico',
      message: `¿Está seguro de eliminar permanentemente el reporte <strong>${repDisplay}</strong>?<br><br><span style="color: var(--color-text-muted); font-size: 0.85rem;">Esta acción eliminará el registro del historial. Los datos del catálogo de equipos y sus horómetros se mantendrán protegidos.</span>`,
      confirmText: 'Sí, eliminar permanentemente',
      cancelText: 'Cancelar',
      isDanger: true,
      icon: '🗑️'
    });

    if (!confirmed) return;

    this._isDeletingReport = true;
    const previousReports = [...this.reports];

    try {
      this.showToast(`Eliminando reporte ${rep ? rep.reportNumber : ''}...`, 'info');

      // Optimistic UI update
      this.reports = this.reports.filter(r => r.id !== reportId && r.reportNumber !== reportId);
      this.renderHistoryTable(this.reports);

      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success !== false) {
        this.showToast(`Reporte ${rep ? rep.reportNumber : reportId} eliminado exitosamente.`, 'success');

        // Si el reporte eliminado era el borrador actual o tenía el mismo ID/correlativo, limpiar estado
        if (this.reportData && (this.reportData.id === reportId || this.reportData.reportNumber === reportId)) {
          this.reportData = this.getEmptyReport();
          localStorage.removeItem('industrac_active_draft');
          await this.restoreOrCreateDraft();
        }

        // Await server reload to guarantee full synchronization across Historial, Horómetros y Catálogo
        await this.loadReports();
        await this.loadHorometersData();
        await this.loadEquipments();
      } else {
        // Rollback on server error
        this.reports = previousReports;
        this.renderHistoryTable(this.reports);
        throw new Error(data.error || `Error del servidor (${res.status})`);
      }
    } catch (e) {
      console.error('Error al eliminar reporte:', e);
      this.reports = previousReports;
      this.renderHistoryTable(this.reports);
      this.showToast('No se pudo eliminar el reporte: ' + e.message, 'error');
    } finally {
      this._isDeletingReport = false;
    }
  }

  // --- CATÁLOGO DE CLIENTES Y EQUIPOS ---

  updateCatalogBadges() {
    const clientsBadge = document.getElementById('catalog-clients-badge');
    const totalEqBadge = document.getElementById('catalog-total-equipments-badge');
    const clientsCount = (this.clients && Array.isArray(this.clients)) ? this.clients.length : 0;
    const totalEqCount = (this.equipments && Array.isArray(this.equipments)) ? this.equipments.length : 0;
    if (clientsBadge) clientsBadge.textContent = clientsCount;
    if (totalEqBadge) totalEqBadge.textContent = totalEqCount;
  }

  filterCatalogClients(query) {
    this.catalogClientSearch = (query || '').toLowerCase().trim();
    this.renderClientsList();
  }

  renderClientsList() {
    const container = document.getElementById('catalog-clients-list');
    if (!container) return;

    let filtered = this.clients;
    if (this.catalogClientSearch) {
      filtered = filtered.filter(c => (c.name || '').toLowerCase().includes(this.catalogClientSearch));
    }

    if (filtered.length === 0) {
      container.innerHTML = '<div style="padding: 1rem; color: #94A3B8; font-size: 0.85rem; text-align: center;">No se encontraron clientes.</div>';
      return;
    }

    container.innerHTML = filtered.map(c => {
      const isActive = this.selectedClientId === c.id;
      const demoBadge = c.isDemo ? '<span class="badge-demo">DEMO</span>' : '';
      return `
        <div 
          class="client-card-item ${isActive ? 'active' : ''}" 
          id="client-card-${c.id}" 
          onclick="window.app.selectClient('${c.id}')"
        >
          <div class="client-card-top">
            <span class="client-card-name">${c.name}</span>
            <div style="display: flex; align-items: center; gap: 0.35rem;">
              ${demoBadge}
              <button 
                type="button" 
                class="btn-client-card-action" 
                title="Editar cliente" 
                onclick="event.stopPropagation(); window.app.openClientModal('${c.id}')"
                style="background: transparent; border: none; cursor: pointer; color: var(--color-accent); font-size: 0.82rem; padding: 2px 4px; border-radius: 4px;"
              >
                ✏️
              </button>
              <button 
                type="button" 
                class="btn-client-card-action" 
                title="Eliminar cliente" 
                onclick="event.stopPropagation(); window.app.deleteClient('${c.id}')"
                style="background: transparent; border: none; cursor: pointer; color: #EF4444; font-size: 0.82rem; padding: 2px 4px; border-radius: 4px;"
              >
                🗑️
              </button>
            </div>
          </div>
          <div class="client-card-counts">
            <span>⚙️ ${c.equipmentCount || 0} equipos</span>
            <span>•</span>
            <span style="color: ${c.activeEquipmentCount > 0 ? 'var(--color-success)' : 'var(--color-text-muted)'};">
              ${c.activeEquipmentCount || 0} activos
            </span>
          </div>
        </div>
      `;
    }).join('');
  }

  selectClient(clientId) {
    this.selectedClientId = clientId;

    // Update active visual state in sidebar
    document.querySelectorAll('.client-card-item').forEach(el => el.classList.remove('active'));
    if (clientId === 'all') {
      document.getElementById('client-card-all')?.classList.add('active');
    } else {
      document.getElementById(`client-card-${clientId}`)?.classList.add('active');
    }

    // Update profile header
    const headerTitle = document.getElementById('active-client-title');
    const headerDesc = document.getElementById('active-client-desc');
    const addBtn = document.getElementById('btn-add-equipment-to-client');
    const delBtn = document.getElementById('btn-delete-client');

    if (clientId === 'all') {
      if (headerTitle) headerTitle.innerHTML = '<span>🌐 Todos los Clientes</span>';
      if (headerDesc) headerDesc.textContent = `Mostrando todo el parque de maquinaria (${this.equipments.length} equipos registrados).`;
      if (addBtn) addBtn.style.display = 'none';
      if (delBtn) delBtn.style.display = 'none';
    } else {
      const client = this.clients.find(c => c.id === clientId);
      if (client) {
        const demoTag = client.isDemo ? ' <span class="badge-demo">CLIENTE DE PRUEBA</span>' : '';
        if (headerTitle) headerTitle.innerHTML = `<span>🏢 ${client.name}</span>${demoTag}`;
        if (headerDesc) headerDesc.textContent = `${client.address || 'Sin dirección registrada'} • ${client.equipmentCount || 0} equipos asociados.`;
        if (addBtn) {
          addBtn.style.display = 'inline-flex';
          addBtn.textContent = `＋ Agregar Compresor a ${client.name}`;
        }
        if (delBtn) {
          delBtn.style.display = 'inline-flex';
          delBtn.onclick = () => this.deleteClient(clientId);
        }
      }
    }

    this.renderEquipmentsCatalog();
  }

  filterCatalogEquipments(query) {
    this.catalogEquipmentSearch = (query || '').toLowerCase().trim();
    this.renderEquipmentsCatalog();
  }

  filterCatalogEquipmentsByStatus(status) {
    this.catalogEquipmentStatus = status;
    this.renderEquipmentsCatalog();
  }

  renderEquipmentsCatalog() {
    const tbody = document.getElementById('equipments-table-body');
    if (!tbody) return;

    let filtered = this.equipments;

    // Filter by selected client
    if (this.selectedClientId !== 'all') {
      const client = this.clients.find(c => c.id === this.selectedClientId);
      filtered = filtered.filter(e => e.clientId === this.selectedClientId || (client && e.client && e.client.toLowerCase() === client.name.toLowerCase()));
    }

    // Filter by query (Model, Serial Number, or API Code)
    if (this.catalogEquipmentSearch) {
      filtered = filtered.filter(e => 
        (e.model || '').toLowerCase().includes(this.catalogEquipmentSearch) ||
        (e.serialNumber || '').toLowerCase().includes(this.catalogEquipmentSearch) ||
        (e.apiCode || '').toLowerCase().includes(this.catalogEquipmentSearch) ||
        (e.manufacturer || '').toLowerCase().includes(this.catalogEquipmentSearch) ||
        (e.client || '').toLowerCase().includes(this.catalogEquipmentSearch)
      );
    }

    // Filter by status
    if (this.catalogEquipmentStatus === 'Activo') {
      filtered = filtered.filter(e => e.status !== 'Inactivo' && e.active !== false);
    } else if (this.catalogEquipmentStatus === 'Inactivo') {
      filtered = filtered.filter(e => e.status === 'Inactivo' || e.active === false);
    } else if (this.catalogEquipmentStatus === 'demo') {
      filtered = filtered.filter(e => !!e.isDemo);
    }

    if (filtered.length === 0) {
      const isSpecificClient = this.selectedClientId && this.selectedClientId !== 'all';
      const clientObj = isSpecificClient ? this.clients.find(c => c.id === this.selectedClientId) : null;
      const clientName = clientObj ? clientObj.name : '';

      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 3rem 1.5rem; color: #64748B;">
            <div style="font-size: 2rem; margin-bottom: 0.65rem;">⚙️</div>
            <div style="font-size: 1.05rem; font-weight: 700; color: var(--color-primary-dark); margin-bottom: 0.4rem;">
              ${isSpecificClient ? `El cliente "${clientName}" aún no tiene compresores registrados.` : 'No se encontraron equipos bajo los criterios seleccionados.'}
            </div>
            ${isSpecificClient ? `
              <p style="font-size: 0.86rem; color: #64748B; max-width: 500px; margin: 0 auto 1.25rem auto;">
                Registre el primer compresor asociado a esta empresa para gestionar sus especificaciones técnicas, horómetro e historial de servicios.
              </p>
              <button type="button" class="btn btn-primary" onclick="window.app.openEquipmentModalForCurrentClient()">
                ＋ Registrar Primer Compresor
              </button>
            ` : ''}
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map(eq => {
      const isAct = eq.status !== 'Inactivo' && eq.active !== false;
      const statusBadge = isAct
        ? `<span class="badge-status active">● Activo</span>`
        : `<span class="badge-status inactive">○ Inactivo</span>`;

      const demoCodeClass = eq.isDemo ? 'demo-code' : '';

      return `
        <tr>
          <td>
            <span class="api-code-badge ${demoCodeClass}" title="Identificador interno único">
              ${eq.apiCode || eq.serialNumber || 'N/A'}
            </span>
          </td>
          <td>
            <strong>${eq.client}</strong>
            ${eq.isDemo ? '<span class="badge-demo" style="margin-left: 0.35rem;">DEMO</span>' : ''}
          </td>
          <td>
            <strong>${eq.model}</strong>
            <span style="font-size: 0.76rem; color: #64748B; display: block;">${eq.manufacturer || 'Atlas Copco'}</span>
          </td>
          <td>${eq.hourMeter || '0'} hrs</td>
          <td>${eq.location || 'Sala de Compresores'}</td>
          <td>
            <div style="display: flex; align-items: center; gap: 0.4rem;">
              ${statusBadge}
            </div>
          </td>
          <td>
            <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
              <button 
                class="btn btn-sm btn-outline-accent" 
                title="Consultar Ficha Técnica y Reportes" 
                onclick="window.app.openEquipmentDetailModal('${eq.id}')"
              >
                🔍 Ficha
              </button>
              <button 
                class="btn btn-sm btn-primary" 
                title="Generar Reporte con este equipo" 
                onclick="window.app.startReportForEquipment('${eq.id}')"
              >
                ⚡ Reporte
              </button>
              <button 
                class="btn btn-sm btn-secondary" 
                title="Editar características" 
                onclick="window.app.openEquipmentModal('${eq.id}')"
              >
                ✏️
              </button>
              <button 
                class="btn btn-sm btn-secondary" 
                title="${isAct ? 'Desactivar sin borrar historial' : 'Activar equipo'}" 
                onclick="window.app.toggleEquipmentStatus('${eq.id}')"
              >
                ${isAct ? '⏸️' : '▶️'}
              </button>
              <button 
                class="btn btn-sm btn-danger" 
                title="Eliminar equipo" 
                onclick="window.app.deleteEquipment('${eq.id}')"
              >
                ✕
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // --- MODAL: DETALLES DE FICHA TÉCNICA E HISTORIAL ---
  async openEquipmentDetailModal(equipmentId) {
    const eq = this.equipments.find(e => e.id === equipmentId);
    if (!eq) return;

    const modal = document.getElementById('equipment-detail-modal');
    if (!modal) return;

    // Save ID on modal header for button references
    const titleEl = document.getElementById('detail-modal-title');
    if (titleEl) {
      titleEl.textContent = `Ficha Técnica: ${eq.manufacturer || 'Atlas Copco'} ${eq.model}`;
      titleEl.setAttribute('data-eq-id', eq.id);
    }

    const badgeCode = document.getElementById('detail-badge-api-code');
    if (badgeCode) badgeCode.textContent = eq.apiCode || 'N/A';

    const subTitle = document.getElementById('detail-modal-subtitle');
    if (subTitle) subTitle.textContent = `Cliente: ${eq.client} • API/ID: ${eq.apiCode || eq.serialNumber || 'N/A'}`;

    const badgeStatus = document.getElementById('detail-badge-status');
    const isAct = eq.status !== 'Inactivo' && eq.active !== false;
    if (badgeStatus) {
      badgeStatus.className = `badge-status ${isAct ? 'active' : 'inactive'}`;
      badgeStatus.textContent = isAct ? '● Activo' : '○ Inactivo';
    }

    // Populate all 13 technical fields
    const setF = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val || 'Pendiente de completar';
    };

    setF('detail-field-client', eq.client);
    setF('detail-field-manufacturer', eq.manufacturer || 'Atlas Copco');
    setF('detail-field-model', eq.model);
    setF('detail-field-serial', eq.serialNumber);
    setF('detail-field-api-code', eq.apiCode);
    setF('detail-field-controller', eq.controller);
    setF('detail-field-pressure', eq.pressure);
    setF('detail-field-airflow', eq.airflow);
    setF('detail-field-oil', eq.oilType);
    setF('detail-field-hours', eq.hourMeter ? `${eq.hourMeter} hrs` : '0 hrs');
    setF('detail-field-location', eq.location);
    setF('detail-field-status', isAct ? 'Activo (En operación)' : 'Inactivo (Fuera de servicio)');
    setF('detail-field-notes', eq.notes || 'Sin observaciones registradas.');

    // Fetch separate report history for this specific machine
    const tbody = document.getElementById('detail-reports-table-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">Cargando historial de reportes...</td></tr>';
      try {
        const res = await fetch(`/api/equipments/${eq.id}/reports`);
        const reports = await res.json();

        if (reports.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="7" style="text-align: center; padding: 1.5rem; color: #94A3B8;">
                No se registran intervenciones técnicas previas para este equipo.
              </td>
            </tr>
          `;
        } else {
          tbody.innerHTML = reports.map(r => `
            <tr>
              <td><strong>${r.reportNumber || 'REP-AUTO'}</strong></td>
              <td>${r.date ? this.formatDateSpanish(r.date) : 'N/A'}</td>
              <td>${r.technician || 'N/A'}</td>
              <td>${r.maintenanceType || 'Mantenimiento'}</td>
              <td>${r.hourMeter || '0'} hrs</td>
              <td><span class="badge ${r.status === 'Finalizado' ? 'badge-success' : 'badge-warning'}">${r.status || 'Borrador'}</span></td>
              <td>
                <div style="display: flex; gap: 0.35rem;">
                  <button class="btn btn-sm btn-outline-accent" onclick="window.app.downloadReportPdf('${r.id}')">PDF</button>
                  <button class="btn btn-sm btn-secondary" onclick="window.app.editReport('${r.id}'); window.app.closeEquipmentDetailModal();">✏️ Ver</button>
                </div>
              </td>
            </tr>
          `).join('');
        }
      } catch (e) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: red;">Error al consultar historial.</td></tr>';
      }
    }

    modal.classList.add('active');
  }

  closeEquipmentDetailModal() {
    const modal = document.getElementById('equipment-detail-modal');
    if (modal) modal.classList.remove('active');
  }

  // --- MODAL: REGISTRAR / EDITAR EQUIPO ---
  openEquipmentModal(equipmentId = null) {
    const modal = document.getElementById('equipment-modal');
    if (!modal) return;

    this.populateModalClientSelect();

    if (equipmentId) {
      const eq = this.equipments.find(e => e.id === equipmentId || (e.apiCode && e.apiCode === equipmentId));
      if (eq) {
        document.getElementById('modal-equipment-title').textContent = `Editar Compresor: ${eq.model}`;
        document.getElementById('modal-eq-id').value = eq.id;

        // Selección robusta de cliente: por clientId o por coincidencia de nombre
        let selectedClientId = eq.clientId || '';
        if (!selectedClientId || !this.clients.some(c => c.id === selectedClientId)) {
          const matchedClient = this.clients.find(c => 
            c.id === eq.clientId || 
            (eq.client && c.name && c.name.trim().toLowerCase() === eq.client.trim().toLowerCase())
          );
          if (matchedClient) selectedClientId = matchedClient.id;
        }
        document.getElementById('modal-eq-client-select').value = selectedClientId;

        document.getElementById('modal-eq-api-code').value = eq.apiCode || eq.serialNumber || '';
        document.getElementById('modal-eq-manufacturer').value = eq.manufacturer || 'Atlas Copco';
        document.getElementById('modal-eq-model').value = eq.model || '';
        document.getElementById('modal-eq-controller').value = eq.controller || '';
        document.getElementById('modal-eq-pressure').value = eq.pressure || '';
        document.getElementById('modal-eq-airflow').value = eq.airflow || '';
        const oilVal = eq.oilType || 'Ndurance (Presentación 5 L)';
        document.getElementById('modal-eq-oil').value = (oilVal === 'NDURANCE') ? 'Ndurance (Presentación 5 L)' : oilVal;
        document.getElementById('modal-eq-hours').value = eq.hourMeter || '0';
        document.getElementById('modal-eq-status').value = eq.status || 'Activo';
        document.getElementById('modal-eq-location').value = eq.location || '';
        document.getElementById('modal-eq-notes').value = eq.notes || '';
      }
    } else {
      document.getElementById('equipment-form').reset();
      document.getElementById('modal-equipment-title').textContent = 'Registrar Nuevo Compresor';
      document.getElementById('modal-eq-id').value = '';
      document.getElementById('modal-eq-manufacturer').value = 'Atlas Copco';
      document.getElementById('modal-eq-status').value = 'Activo';
      document.getElementById('modal-eq-oil').value = 'Ndurance (Presentación 5 L)';

      // Preselect active client if filtered
      if (this.selectedClientId && this.selectedClientId !== 'all') {
        document.getElementById('modal-eq-client-select').value = this.selectedClientId;
      }
    }

    modal.classList.add('active');
  }

  openEquipmentModalForCurrentClient() {
    this.openEquipmentModal(null);
  }

  closeEquipmentModal() {
    const modal = document.getElementById('equipment-modal');
    if (modal) modal.classList.remove('active');
  }

  async saveEquipment(e) {
    e.preventDefault();
    const id = document.getElementById('modal-eq-id').value;
    const clientId = document.getElementById('modal-eq-client-select').value;
    const clientObj = this.clients.find(c => c.id === clientId);

    const apiVal = document.getElementById('modal-eq-api-code').value.trim();
    const modelVal = document.getElementById('modal-eq-model').value.trim();

    if (!modelVal) {
      this.showToast('El modelo del compresor es obligatorio.', 'warning');
      return;
    }
    if (!apiVal) {
      this.showToast('El código API / ID Máquina es obligatorio.', 'warning');
      return;
    }

    const eqId = id || `eq-${Date.now()}`;
    const payload = {
      id: eqId,
      clientId: clientId || (clientObj ? clientObj.id : ''),
      client: clientObj ? clientObj.name : '',
      apiCode: apiVal,
      manufacturer: document.getElementById('modal-eq-manufacturer').value.trim() || 'Atlas Copco',
      model: modelVal,
      serialNumber: apiVal,
      controller: document.getElementById('modal-eq-controller').value.trim(),
      pressure: document.getElementById('modal-eq-pressure').value.trim(),
      airflow: document.getElementById('modal-eq-airflow').value.trim(),
      oilType: document.getElementById('modal-eq-oil').value.trim() || 'Ndurance (Presentación 5 L)',
      hourMeter: document.getElementById('modal-eq-hours').value.trim() || '0',
      hours: Number(document.getElementById('modal-eq-hours').value.trim()) || 0,
      status: document.getElementById('modal-eq-status').value || 'Activo',
      active: document.getElementById('modal-eq-status').value !== 'Inactivo',
      location: document.getElementById('modal-eq-location').value.trim() || 'Sala de Compresores',
      notes: document.getElementById('modal-eq-notes').value.trim(),
      isDemo: false,
      updatedAt: new Date().toISOString()
    };

    // 1. Guardado inmediato en memoria y localStorage (Inmune a recarga de página)
    const existingIdx = this.equipments.findIndex(eq => 
      (id && eq.id === id) || 
      eq.id === eqId || 
      (eq.apiCode && eq.apiCode.toLowerCase() === apiVal.toLowerCase())
    );
    if (existingIdx !== -1) {
      this.equipments[existingIdx] = { ...this.equipments[existingIdx], ...payload };
    } else {
      this.equipments.push(payload);
    }
    this.persistLocalCatalogCache();
    this.recalculateClientCounts();
    this.renderEquipmentsCatalog();
    this.renderClientsList();
    this.updateCatalogBadges();

    this.closeEquipmentModal();

    // 2. Persistir en el servidor
    try {
      let res;
      if (id) {
        res = await fetch(`/api/equipments/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch('/api/equipments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Error del servidor (${res.status})`);
      }

      const data = await res.json().catch(() => ({}));
      if (data && data.id) {
        const idx = this.equipments.findIndex(eq => eq.id === eqId || eq.id === id);
        if (idx !== -1) {
          this.equipments[idx] = { ...this.equipments[idx], ...data };
          this.persistLocalCatalogCache();
        }
      }
      this.showToast(`Compresor "${payload.model}" guardado exitosamente.`, 'success');
      this.renderEquipmentsCatalog();
      this.syncReportEquipmentSelects();
    } catch (err) {
      console.warn('Aviso: guardado local activo para compresor:', err);
      this.showToast(`Guardado localmente: ${err.message}`, 'warning');
    }
  }

  async toggleEquipmentStatus(equipmentId) {
    try {
      const res = await fetch(`/api/equipments/${encodeURIComponent(equipmentId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      if (res.ok) {
        const data = await res.json();
        this.showToast(data.message || 'Estado actualizado.', 'success');
        await this.loadEquipments();
        await this.loadClients();
      }
    } catch (e) {
      this.showToast('Error al actualizar estado del equipo.', 'error');
    }
  }

  // --- MODAL DE CONFIRMACIÓN ELEGANTE (SIN DEPENDER DE WINDOW.CONFIRM) ---
  showConfirmModal({ title = 'Confirmación Requerida', message = '¿Está seguro de continuar?', confirmText = 'Confirmar', cancelText = 'Cancelar', isDanger = true, icon = '⚠️' } = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirm-modal');
      const titleEl = document.getElementById('confirm-modal-title');
      const msgEl = document.getElementById('confirm-modal-message');
      const iconEl = document.getElementById('confirm-modal-icon');
      const btnAccept = document.getElementById('confirm-modal-btn-accept');
      const btnCancel = document.getElementById('confirm-modal-btn-cancel');
      const btnClose = document.getElementById('confirm-modal-btn-close');

      if (!modal || !btnAccept || !btnCancel) {
        resolve(window.confirm(message.replace(/<[^>]+>/g, '')));
        return;
      }

      if (titleEl) titleEl.textContent = title;
      if (msgEl) msgEl.innerHTML = message;
      if (iconEl) iconEl.textContent = icon;
      btnAccept.textContent = confirmText;
      btnAccept.className = isDanger ? 'btn btn-danger' : 'btn btn-primary';
      btnCancel.textContent = cancelText;

      const cleanup = (result) => {
        modal.classList.remove('active');
        btnAccept.onclick = null;
        btnCancel.onclick = null;
        if (btnClose) btnClose.onclick = null;
        modal.onclick = null;
        resolve(result);
      };

      btnAccept.onclick = () => cleanup(true);
      btnCancel.onclick = () => cleanup(false);
      if (btnClose) btnClose.onclick = () => cleanup(false);
      modal.onclick = (e) => {
        if (e.target === modal) cleanup(false);
      };

      modal.classList.add('active');
    });
  }

  deleteCurrentClient() {
    if (this.selectedClientId && this.selectedClientId !== 'all') {
      this.deleteClient(this.selectedClientId);
    } else {
      this.showToast('Por favor, seleccione un cliente para eliminar.', 'warning');
    }
  }

  async deleteEquipment(equipmentId) {
    const eq = this.equipments.find(e => e.id === equipmentId || (e.apiCode && e.apiCode === equipmentId));
    const eqName = eq ? `${eq.model || 'Equipo'} (${eq.apiCode || eq.serialNumber || 'S/N'})` : 'este equipo';

    const confirmed = await this.showConfirmModal({
      title: 'Eliminar Compresor',
      message: `¿Está seguro de eliminar <strong>"${eqName}"</strong> del catálogo?<br><br><span style="color:var(--color-text-muted); font-size:0.85rem;">Su historial de reportes se conservará en el sistema.</span>`,
      confirmText: '🗑️ Sí, Eliminar Equipo',
      cancelText: 'Cancelar',
      isDanger: true,
      icon: '🗑️'
    });

    if (!confirmed) return;

    const targetEqId = eq ? eq.id : equipmentId;
    const targetApiCode = eq ? (eq.apiCode || eq.serialNumber) : equipmentId;

    // Registrar en lista de IDs eliminados para evitar resurrección automática por caché
    try {
      const deletedIds = JSON.parse(localStorage.getItem('industrac_deleted_equipments') || '[]');
      if (targetEqId && !deletedIds.includes(targetEqId)) deletedIds.push(targetEqId);
      if (targetApiCode && !deletedIds.includes(targetApiCode)) deletedIds.push(targetApiCode);
      localStorage.setItem('industrac_deleted_equipments', JSON.stringify(deletedIds.slice(-100)));
    } catch (e) {}

    // Actualización inmediata en memoria y localStorage (Inmune a recarga de página)
    this.equipments = this.equipments.filter(e => 
      e.id !== targetEqId && 
      e.id !== equipmentId && 
      (!targetApiCode || (e.apiCode !== targetApiCode && e.serialNumber !== targetApiCode))
    );
    this.persistLocalCatalogCache();
    this.recalculateClientCounts();
    this.renderEquipmentsCatalog();
    this.renderClientsList();
    this.updateCatalogBadges();
    this.syncReportEquipmentSelects();

    try {
      const res = await fetch(`/api/equipments/${encodeURIComponent(targetEqId)}`, { method: 'DELETE' });
      if (res.ok) {
        this.showToast('Equipo eliminado del catálogo.', 'success');
        await this.loadEquipments();
        await this.loadClients();
        await this.loadHorometersData();
      } else {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo eliminar el equipo en el servidor');
      }
    } catch (e) {
      this.showToast('Aviso de eliminación: ' + e.message, 'warning');
    }
  }

  // --- MODAL: REGISTRAR / EDITAR CLIENTE ---
  openClientModal(clientId = null) {
    const modal = document.getElementById('client-modal');
    if (!modal) return;

    const delModalBtn = document.getElementById('btn-modal-delete-client');

    if (clientId) {
      const client = this.clients.find(c => c.id === clientId);
      if (client) {
        document.getElementById('modal-client-title').textContent = `Editar Cliente: ${client.name}`;
        document.getElementById('modal-client-id').value = client.id;
        document.getElementById('modal-client-name').value = client.name;
        document.getElementById('modal-client-address').value = client.address || '';
        document.getElementById('modal-client-contact').value = client.contact || '';
        document.getElementById('modal-client-notes').value = client.notes || '';
        if (delModalBtn) delModalBtn.style.display = 'inline-flex';
      }
    } else {
      document.getElementById('client-form').reset();
      document.getElementById('modal-client-title').textContent = 'Registrar Nuevo Cliente';
      document.getElementById('modal-client-id').value = '';
      if (delModalBtn) delModalBtn.style.display = 'none';
    }

    modal.classList.add('active');
  }

  deleteClientFromModal() {
    const id = document.getElementById('modal-client-id').value;
    if (id) {
      this.closeClientModal();
      this.deleteClient(id);
    }
  }

  async deleteClient(clientId) {
    const client = this.clients.find(c => c.id === clientId);
    if (!client) {
      this.showToast('Cliente no encontrado.', 'error');
      return;
    }

    const eqCount = client.equipmentCount || 0;
    let warningMsg = '';
    if (eqCount > 0) {
      warningMsg = `<div style="margin-top:0.6rem; padding:0.6rem 0.8rem; background:#FEF2F2; border:1px solid #FECACA; border-radius:6px; color:#DC2626; font-size:0.84rem;">
        <strong>⚠️ Advertencia:</strong> Este cliente tiene <strong>${eqCount} compresor(es) asociado(s)</strong>. Al eliminarlo, se darán de baja o desvincularán del catálogo de equipos.
      </div>`;
    } else {
      warningMsg = `<div style="margin-top:0.5rem; color:var(--color-text-muted); font-size:0.84rem;">Esta acción no se puede deshacer.</div>`;
    }

    const confirmed = await this.showConfirmModal({
      title: 'Eliminar Cliente',
      message: `¿Está seguro de que desea eliminar al cliente <strong>"${client.name}"</strong>?${warningMsg}`,
      confirmText: '🗑️ Sí, Eliminar Cliente',
      cancelText: 'Cancelar',
      isDanger: true,
      icon: '🗑️'
    });

    if (!confirmed) return;

    // Registrar en lista de clientes eliminados para evitar resurrección automática por caché
    try {
      const deletedClients = JSON.parse(localStorage.getItem('industrac_deleted_clients') || '[]');
      if (clientId && !deletedClients.includes(clientId)) deletedClients.push(clientId);
      if (client.name && !deletedClients.includes(client.name.trim().toLowerCase())) {
        deletedClients.push(client.name.trim().toLowerCase());
      }
      localStorage.setItem('industrac_deleted_clients', JSON.stringify(deletedClients.slice(-100)));
    } catch (e) {}

    // Actualización inmediata en memoria y localStorage (Inmune a recarga de página)
    const clientNameLower = (client.name || '').toLowerCase().trim();
    this.clients = this.clients.filter(c => c.id !== clientId);
    this.equipments = this.equipments.filter(e => e.clientId !== clientId && (e.client || '').toLowerCase().trim() !== clientNameLower);
    this.persistLocalCatalogCache();
    this.recalculateClientCounts();
    this.renderClientsList();
    this.renderEquipmentsCatalog();
    this.updateCatalogBadges();
    this.populateReportClientSelect();
    this.populateModalClientSelect();

    if (this.selectedClientId === clientId) {
      this.selectClient('all');
    }

    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}?removeEquipments=true`, { method: 'DELETE' });
      if (res.ok) {
        this.showToast(`Cliente "${client.name}" eliminado exitosamente.`, 'success');
        await this.loadClients();
        await this.loadEquipments();
      } else {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo eliminar el cliente en el servidor');
      }
    } catch (e) {
      this.showToast('Aviso de eliminación: ' + e.message, 'warning');
    }
  }

  closeClientModal() {
    const modal = document.getElementById('client-modal');
    if (modal) modal.classList.remove('active');
  }

  async saveClient(e) {
    e.preventDefault();
    const id = document.getElementById('modal-client-id').value;
    const name = document.getElementById('modal-client-name').value.trim();
    const address = document.getElementById('modal-client-address').value.trim();
    const contact = document.getElementById('modal-client-contact').value.trim();
    const notes = document.getElementById('modal-client-notes').value.trim();

    if (!name) {
      this.showToast('El nombre de la empresa / cliente es obligatorio.', 'warning');
      return;
    }

    const clientId = id || `cli-${Date.now()}`;
    const payload = {
      id: clientId,
      name,
      address,
      contact,
      notes,
      isDemo: false,
      updatedAt: new Date().toISOString()
    };

    // 1. Guardado inmediato en memoria y localStorage (Inmune a recarga de página)
    const existingIdx = this.clients.findIndex(c => c.id === clientId || (c.name && c.name.toLowerCase().trim() === name.toLowerCase().trim()));
    if (existingIdx !== -1) {
      this.clients[existingIdx] = { ...this.clients[existingIdx], ...payload };
    } else {
      this.clients.push({ ...payload, equipmentCount: 0, activeEquipmentCount: 0 });
    }
    this.persistLocalCatalogCache();
    this.recalculateClientCounts();
    this.renderClientsList();
    this.updateCatalogBadges();
    this.populateReportClientSelect();
    this.populateModalClientSelect();

    this.closeClientModal();
    this.showToast(`Cliente "${payload.name}" guardado exitosamente.`, 'success');

    // Limpiar filtro de búsqueda
    const searchInput = document.getElementById('catalog-client-search');
    if (searchInput) searchInput.value = '';
    this.catalogClientSearch = '';

    // Seleccionar automáticamente el cliente nuevo
    this.selectClient(clientId);
    const cardEl = document.getElementById(`client-card-${clientId}`);
    if (cardEl) cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // 2. Persistir en el servidor
    try {
      let res;
      if (id) {
        res = await fetch(`/api/clients/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch('/api/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      const data = await res.json().catch(() => ({}));
      if (res.ok && data) {
        if (data.id && data.id !== clientId) {
          const idx = this.clients.findIndex(c => c.id === clientId);
          if (idx !== -1) this.clients[idx].id = data.id;
          this.persistLocalCatalogCache();
        }
      }
    } catch (err) {
      console.warn('Aviso: guardado local activo para cliente:', err);
    }
  }

  // --- MODO DEMOSTRACIÓN RETIRADO EN PRODUCCIÓN ---
  openDemoManagerModal() {}
  closeDemoManagerModal() {}
  async loadDemoData() {}
  async clearDemoData() {}

  // --- ADMINISTRACIÓN DE PLANES DE MANTENIMIENTO ---
  renderPlansView() {
    const container = document.getElementById('plans-view-container');
    if (!container || !this.plans) return;

    const defaultPlans = this.plans.defaultPlans || {};
    const allTasks = this.plans.allTasks || [];

    // Filter alias numeric keys (e.g., '2000 horas') to only display official named plans
    const visibleKeys = Object.keys(defaultPlans).filter(k => !/^\d+\s*horas$/.test(k));

    container.innerHTML = `
      <div class="plans-admin-grid">
        ${visibleKeys.map(planKey => {
          const plan = defaultPlans[planKey];
          const autoItems = plan.autoLoadItems || [];
          const tasks = plan.suggestedTasks || [];

          const autoItemsHtml = autoItems.length > 0 ? `
            <div style="margin-top: 0.35rem;">
              <div class="plan-section-title">
                <span>📦</span> Cargar automáticamente:
              </div>
              <div class="plan-auto-items-list">
                ${autoItems.map(item => `
                  <div class="plan-auto-item-row">
                    <span>• ${item}</span>
                    <span style="color: #10B981; font-size: 0.75rem; font-weight: 700;">✓ Auto</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : `
            <div style="margin-top: 0.35rem;">
              <div class="plan-section-title">
                <span>📦</span> Cargar automáticamente:
              </div>
              <div style="color: #94A3B8; font-size: 0.82rem; font-style: italic; padding: 0.5rem;">
                (Selección libre según servicio en campo)
              </div>
            </div>
          `;

          const tasksHtml = tasks.length > 0 ? `
            <div style="margin-top: 0.65rem;">
              <div class="plan-section-title">
                <span>🔧</span> Protocolo Técnico y Tareas Asociadas:
              </div>
              <div class="plan-tasks-tags">
                ${tasks.map(tId => {
                  const found = allTasks.find(t => t.id === tId);
                  return `<span class="plan-task-pill">✓ ${found ? found.name : tId}</span>`;
                }).join('')}
              </div>
            </div>
          ` : '';

          const hoursBadge = plan.hours ? `<span class="plan-hours-badge">${plan.hours.toLocaleString()} hrs</span>` : '';

          return `
            <div class="plan-admin-card ${planKey.startsWith('Plan') ? 'featured' : ''}">
              <div class="plan-card-header">
                <div class="plan-card-title-group">
                  <h3>⚙️ ${planKey}</h3>
                  <p>${plan.description || ''}</p>
                </div>
                ${hoursBadge}
              </div>

              ${autoItemsHtml}
              ${tasksHtml}

              <div class="plan-card-footer">
                <button type="button" class="btn btn-primary btn-sm" onclick="window.app.applyPlanToNewReport('${planKey}')">
                  🚀 Aplicar este Plan al Reporte
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  applyPlanToNewReport(planKey) {
    this.reportData.maintenanceType = planKey;
    const maintSelect = document.getElementById('maintenance-type-select');
    if (maintSelect) maintSelect.value = planKey;

    this.suggestMechanicalTasks(planKey);
    this.switchTab('tab-report');
    this.goToStep(2);
    this.showToast(`Plan "${planKey}" aplicado exitosamente con sus repuestos automáticos.`, 'success');
  }

  // --- GOOGLE SHEETS INTEGRATION ---
  async openGoogleSheetsModal() {
    const modal = document.getElementById('google-sheets-modal');
    if (!modal) return;

    try {
      const res = await fetch('/api/settings');
      const settings = await res.json();
      const inputUrl = document.getElementById('input-sheets-webhook-url');
      const chkAuto = document.getElementById('checkbox-sheets-autosync');
      const badge = document.getElementById('sheets-connection-badge');
      const lastSyncEl = document.getElementById('sheets-last-sync-text');

      if (inputUrl) inputUrl.value = settings.googleSheetsWebhookUrl || '';
      if (chkAuto) chkAuto.checked = settings.autoSyncSheets !== false;

      if (settings.googleSheetsWebhookUrl) {
        if (badge) {
          badge.textContent = '● Configurado';
          badge.style.background = '#D1E7DD';
          badge.style.color = '#0F5132';
        }
      } else {
        if (badge) {
          badge.textContent = '○ No configurado';
          badge.style.background = '#E2E8F0';
          badge.style.color = '#475569';
        }
      }

      if (lastSyncEl) {
        lastSyncEl.textContent = settings.lastSyncTime 
          ? `Última sincronización: ${new Date(settings.lastSyncTime).toLocaleString()}`
          : 'Última sincronización: Ninguna';
      }
    } catch (e) {
      console.warn('Error cargando configuración de Google Sheets:', e);
    }

    modal.classList.add('active');
  }

  closeGoogleSheetsModal() {
    const modal = document.getElementById('google-sheets-modal');
    if (modal) modal.classList.remove('active');
  }

  async saveGoogleSheetsSettings() {
    const url = (document.getElementById('input-sheets-webhook-url')?.value || '').trim();
    const autoSync = document.getElementById('checkbox-sheets-autosync')?.checked ?? true;

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          googleSheetsWebhookUrl: url,
          autoSyncSheets: autoSync
        })
      });

      if (res.ok) {
        this.showToast('Configuración de Google Sheets guardada.', 'success');
        this.closeGoogleSheetsModal();
      } else {
        throw new Error('No se pudo guardar la configuración.');
      }
    } catch (err) {
      this.showToast('Error: ' + err.message, 'error');
    }
  }

  async testGoogleSheetsConnection() {
    const url = (document.getElementById('input-sheets-webhook-url')?.value || '').trim();
    if (!url) {
      this.showToast('Por favor ingrese la URL del Webhook de Apps Script.', 'warning');
      return;
    }

    this.showToast('Probando conexión con Google Sheets...', 'info');

    try {
      const res = await fetch('/api/google-sheets/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const data = await res.json();
      if (res.ok && data.status === 'success') {
        const folderText = data.driveFolderName ? ` | Carpeta Drive: ${data.driveFolderName}` : '';
        this.showToast(`¡Conexión Exitosa con Sheets & Drive! ${data.sheetName || 'Hoja'}${folderText}`, 'success');
        const badge = document.getElementById('sheets-connection-badge');
        if (badge) {
          badge.textContent = '● Conectado (Sheets & Drive)';
          badge.style.background = '#D1E7DD';
          badge.style.color = '#0F5132';
        }
      } else {
        throw new Error(data.error || data.message || 'Error de conexión');
      }
    } catch (err) {
      this.showToast('Error de conexión con Google Sheets: ' + err.message, 'error');
    }
  }

  async syncAllToGoogleSheets() {
    const url = (document.getElementById('input-sheets-webhook-url')?.value || '').trim();
    if (!url) {
      this.showToast('Configure y guarde primero la URL del Webhook.', 'warning');
      return;
    }

    this.showToast('Iniciando sincronización completa a Google Sheets...', 'info');

    try {
      // First save URL if changed
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ googleSheetsWebhookUrl: url })
      });

      const res = await fetch('/api/google-sheets/sync-all', { method: 'POST' });
      const data = await res.json();

      if (res.ok) {
        this.showToast(data.message || '¡Datos sincronizados exitosamente con Google Sheets!', 'success');
        const lastSyncEl = document.getElementById('sheets-last-sync-text');
        if (lastSyncEl) {
          lastSyncEl.textContent = `Última sincronización: ${new Date().toLocaleString()}`;
        }
      } else {
        throw new Error(data.error || 'Error al sincronizar.');
      }
    } catch (err) {
      this.showToast('Error al sincronizar con Google Sheets: ' + err.message, 'error');
    }
  }

  async pullFromGoogleSheets() {
    this.showToast('Descargando catálogo de Clientes y Equipos desde Google Sheets...', 'info');
    try {
      const res = await fetch('/api/settings/pull-sheets', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast(data.message || 'Catálogo actualizado desde Google Sheets', 'success');
        await this.loadClients();
        await this.loadEquipments();
        await this.loadHorometersData();
        const lastSyncEl = document.getElementById('sheets-last-sync-text');
        if (lastSyncEl) {
          lastSyncEl.textContent = `Última sincronización: ${new Date().toLocaleString()}`;
        }
      } else {
        throw new Error(data.message || 'No se pudo obtener datos');
      }
    } catch (err) {
      this.showToast('Aviso: ' + err.message, 'warning');
    }
  }

  // --- TOAST NOTIFICATIONS ---
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'warning') icon = '⚠️';
    if (type === 'error') icon = '❌';

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ========================================================================
  // MÓDULO DE HORÓMETROS Y PRÓXIMOS MANTENIMIENTOS
  // ========================================================================

  // ========================================================================
  // MÓDULO DE HORÓMETROS Y PRÓXIMOS MANTENIMIENTOS (DASHBOARD PREDICTIVO)
  // ========================================================================

  async setHorometerMode(mode) {
    if (this.horometerMode === mode) return;
    this.horometerMode = mode;
    this.horometerStatusFilter = 'all';
    this.horometerPlanFilter = 'all';
    this.horometerCycleFilter = 'all';
    this.horometerMonthFilter = null;
    this.activeKpiFilter = null;
    this.horometerSearch = '';

    // Update segmented pill UI
    const btnReal = document.getElementById('btn-mode-real');
    const btnDemo = document.getElementById('btn-mode-demo');
    if (btnReal && btnDemo) {
      btnReal.classList.toggle('active', mode === 'real');
      btnDemo.classList.toggle('active', mode === 'demo');
    }

    // Toggle demo banner
    const demoBanner = document.getElementById('horometers-demo-banner');
    if (demoBanner) {
      demoBanner.style.display = mode === 'demo' ? 'flex' : 'none';
    }

    // Reset toolbar inputs
    const searchInp = document.getElementById('horometer-search-input');
    if (searchInp) searchInp.value = '';
    const stSelect = document.getElementById('horometer-filter-status');
    if (stSelect) stSelect.value = 'all';
    const plSelect = document.getElementById('horometer-filter-plan');
    if (plSelect) plSelect.value = 'all';
    const cySelect = document.getElementById('horometer-filter-cycle');
    if (cySelect) cySelect.value = 'all';
    const sortSelect = document.getElementById('horometer-sort-by');
    if (sortSelect) sortSelect.value = 'urgency';

    await this.loadHorometersData();
  }

  async resetDemoHorometers() {
    this.showToast('El modo demostración ha sido retirado. El sistema opera con datos reales.', 'info');
  }

  async loadHorometersData() {
    try {
      const res = await fetch('/api/horometers');
      if (!res.ok) throw new Error('Error al cargar datos de horómetros');
      const data = await res.json();

      this.horometersData = data.equipments || [];
      this.horometersSummary = data.summary || null;
      this.horometersPriorityList = data.priorityAttention || [];
      this.horometersMonthlyProjection = data.monthlyProjection || null;

      this.renderHorometersKPIs();
      this.renderPriorityAttentionCards();
      this.renderMonthlyProjectionChart();
      this.filterAndRenderHorometers();
    } catch (err) {
      console.error('Error cargando horómetros:', err);
      this.showToast('Error cargando tablero de horómetros: ' + err.message, 'error');
    }
  }

  renderHorometersKPIs() {
    const s = this.horometersSummary;
    if (!s) return;

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = (val ?? 0).toLocaleString();
    };

    setVal('kpi-total-equipments', s.total);
    setVal('kpi-uptodate', s.upToDate);
    setVal('kpi-upcoming', s.upcomingTotal ?? s.upcoming);
    setVal('kpi-overdue-hours', s.overdueHours);
    setVal('kpi-overdue-date', s.overdueDate);
    setVal('kpi-overdue-both', s.overdueBoth);
    setVal('kpi-pending-config', s.pendingConfig);

    // Update active highlight class on KPI cards
    document.querySelectorAll('.horometer-kpi-card').forEach(card => {
      const filter = card.getAttribute('data-filter');
      card.classList.toggle('active-filter', this.horometerStatusFilter === filter && filter !== 'all');
    });
  }

  onKpiCardClick(statusKey) {
    if (this.horometerStatusFilter === statusKey) {
      // Toggle off
      this.horometerStatusFilter = 'all';
      this.activeKpiFilter = null;
    } else {
      this.horometerStatusFilter = statusKey;
      this.activeKpiFilter = statusKey;
    }

    // Sync dropdown
    const filterSelect = document.getElementById('horometer-filter-status');
    if (filterSelect) filterSelect.value = this.horometerStatusFilter;

    this.filterAndRenderHorometers();
  }

  renderPriorityAttentionCards() {
    const container = document.getElementById('horometers-priority-cards');
    const badge = document.getElementById('priority-attention-badge');
    if (!container) return;

    const list = this.horometersPriorityList || [];
    if (badge) badge.textContent = list.length;

    if (list.length === 0) {
      container.innerHTML = `
        <div class="empty-state-card" style="padding: 2.5rem 1rem; text-align: center; color: var(--color-text-muted); background: #F8FAFC; border-radius: 8px; border: 1px dashed var(--color-border);">
          <span style="font-size: 2rem;">🎉</span>
          <h4 style="margin: 0.5rem 0 0.2rem; color: #047857;">¡Toda la flota al día!</h4>
          <p style="font-size: 0.82rem; margin: 0;">No existen equipos en estado vencido o con proximidad crítica a hito u horizonte trimestral.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = list.slice(0, 6).map(item => {
      let borderClass = 'border-slate';
      let calloutClass = 'callout-slate';
      if (item.status === 'overdue_both') { borderClass = 'border-crimson'; calloutClass = ''; }
      else if (item.status === 'overdue_hours') { borderClass = 'border-red'; calloutClass = ''; }
      else if (item.status === 'overdue_date') { borderClass = 'border-orange'; calloutClass = 'callout-amber'; }
      else if (item.status?.startsWith('upcoming')) { borderClass = 'border-amber'; calloutClass = 'callout-amber'; }
      else if (item.status === 'up_to_date') { borderClass = 'border-green'; calloutClass = 'callout-green'; }

      // Hours badge
      let hoursBadge = '';
      if (item.hoursRemaining !== null && item.hoursRemaining !== undefined) {
        if (item.hoursRemaining <= 0) {
          hoursBadge = `<span style="color: #DC2626; font-weight: 800;">+${Math.abs(item.hoursRemaining).toLocaleString()} h excedidas</span>`;
        } else {
          hoursBadge = `<span style="color: #059669; font-weight: 800;">${item.hoursRemaining.toLocaleString()} h restantes</span>`;
        }
      } else {
        hoursBadge = '<span style="color: #64748B;">N/D</span>';
      }

      const cycleLabel = item.cycle === 'ciclo_3000' || item.cycleType === 'ciclo_3000'
        ? '<span class="pill-cycle-spe" style="font-size: 0.68rem; padding: 2px 6px; border-radius: 4px;">⭐ Ciclo 3k</span>'
        : '<span class="pill-cycle-std" style="font-size: 0.68rem; padding: 2px 6px; border-radius: 4px;">⚙️ Ciclo 2k</span>';

      return `
        <div class="priority-card ${borderClass}">
          <div class="priority-card-header">
            <div>
              <div class="priority-card-client">
                ${item.client}
                ${item.isDemo ? '<span class="demo-tag-badge">DEMO</span>' : ''}
              </div>
              <div class="priority-card-model">
                ${item.model} • <span class="eq-id-badge" style="font-size: 0.78rem;">${item.apiCode || 'S/C'}</span> ${cycleLabel}
              </div>
            </div>
            <div>
              ${this.formatStatusBadge(item)}
            </div>
          </div>

          <!-- Alert Reason Callout -->
          <div class="priority-callout-box ${calloutClass}">
            <span style="font-size: 1.1rem; line-height: 1;">${item.statusIcon || '⚠️'}</span>
            <div>
              <strong>Motivo de alerta:</strong> ${item.alertReason || 'Intervención recomendada en los parámetros técnicos.'}
            </div>
          </div>

          <!-- Stat Grid -->
          <div class="priority-stat-grid">
            <div class="priority-stat-item">
              <span class="priority-stat-label">Horómetro Actual</span>
              <span class="priority-stat-val">${(item.currentHours ?? 0).toLocaleString()} hrs</span>
            </div>
            <div class="priority-stat-item">
              <span class="priority-stat-label">Próximo Plan</span>
              <span class="priority-stat-val" style="color: var(--color-primary); font-size: 0.8rem;">${item.nextPlan || 'N/D'}</span>
            </div>
            <div class="priority-stat-item">
              <span class="priority-stat-label">Hito Programado</span>
              <span class="priority-stat-val">${item.nextMilestoneHours ? item.nextMilestoneHours.toLocaleString() + ' h' : 'N/D'}</span>
            </div>
            <div class="priority-stat-item">
              <span class="priority-stat-label">Límite Trimestral</span>
              <span class="priority-stat-val">${item.quarterlyEstimatedDate ? this.formatDateSpanish(item.quarterlyEstimatedDate) : 'N/D'}</span>
            </div>
          </div>

          <!-- Quick Action Buttons -->
          <div class="priority-card-actions">
            <button type="button" class="btn btn-xs btn-outline-primary" title="Registrar lectura de horómetro" onclick="window.app.openHorometerReadingModal('${item.id}')">
              ⏱️ + Lectura
            </button>
            <button type="button" class="btn btn-xs btn-outline-success" title="Registrar servicio de mantenimiento ejecutado" onclick="window.app.openHorometerMaintenanceModal('${item.id}')">
              🔧 + Mantenimiento
            </button>
            <button type="button" class="btn btn-xs btn-secondary" title="Abrir ficha técnica y diagnóstico completo" onclick="window.app.openHorometerHistoryModal('${item.id}')">
              📋 Ficha &amp; Historial
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  renderMonthlyProjectionChart() {
    const container = document.getElementById('horometers-monthly-chart');
    if (!container) return;

    const proj = this.horometersMonthlyProjection;
    if (!proj || !Array.isArray(proj.buckets) || proj.buckets.length === 0) {
      container.innerHTML = `
        <div class="empty-state-card" style="padding: 2rem 1rem; text-align: center; color: var(--color-text-muted);">
          <span>ℹ️</span> No hay suficientes datos para calcular proyecciones mensuales de mantenimiento.
        </div>
      `;
      return;
    }

    container.innerHTML = proj.buckets.map(b => {
      const isOverdue = !!b.isOverdueBucket;
      const isPending = b.monthKey === 'sin_prevision';
      const isActive = this.horometerMonthFilter === b.monthKey;
      let colClass = 'month-chart-col';
      if (isOverdue) colClass += ' col-overdue';
      if (isActive) colClass += ' active';

      // Calculate bar segments
      const tot = b.total || 0;
      let barHtml = '';
      if (tot > 0) {
        const pctA = Math.round((b.planA / tot) * 100);
        const pctB = Math.round((b.planB / tot) * 100);
        const pctC = Math.round((b.planC / tot) * 100);
        barHtml = `
          <div class="month-stacked-bar">
            ${pctA > 0 ? `<div class="bar-segment-a" style="width: ${pctA}%;" title="${b.planA} Plan A (${pctA}%)"></div>` : ''}
            ${pctB > 0 ? `<div class="bar-segment-b" style="width: ${pctB}%;" title="${b.planB} Plan B (${pctB}%)"></div>` : ''}
            ${pctC > 0 ? `<div class="bar-segment-c" style="width: ${pctC}%;" title="${b.planC} Plan C (${pctC}%)"></div>` : ''}
          </div>
        `;
      } else {
        barHtml = `<div class="month-stacked-bar" style="background: #F1F5F9;"></div>`;
      }

      return `
        <div class="${colClass}" onclick="window.app.onMonthChartClick('${b.monthKey}')" title="${b.fullLabel || b.label} — Haga clic para filtrar ${tot} equipo(s)">
          <span class="month-chart-label">${b.label}</span>
          <span class="month-chart-count">${tot}</span>
          ${barHtml}
          <div class="month-plan-breakdown">
            ${tot > 0 ? `
              <span>${b.planA > 0 ? `<strong>${b.planA}</strong>A ` : ''}${b.planB > 0 ? `<strong>${b.planB}</strong>B ` : ''}${b.planC > 0 ? `<strong>${b.planC}</strong>C` : ''}</span>
              ${b.cycle3k > 0 ? `<span style="color: #7E22CE; font-weight: 700;">★ ${b.cycle3k} ciclo 3k</span>` : ''}
            ` : `<span style="color: #94A3B8;">Sin servicios</span>`}
          </div>
        </div>
      `;
    }).join('');
  }

  onMonthChartClick(monthKey) {
    if (this.horometerMonthFilter === monthKey) {
      this.horometerMonthFilter = null;
    } else {
      this.horometerMonthFilter = monthKey;
    }

    this.renderMonthlyProjectionChart();
    this.filterAndRenderHorometers();
  }

  clearAllHorometerFilters() {
    this.horometerSearch = '';
    this.horometerStatusFilter = 'all';
    this.horometerPlanFilter = 'all';
    this.horometerCycleFilter = 'all';
    this.horometerMonthFilter = null;
    this.activeKpiFilter = null;
    this.horometerSortBy = 'urgency';

    const searchInp = document.getElementById('horometer-search-input');
    if (searchInp) searchInp.value = '';
    const stSelect = document.getElementById('horometer-filter-status');
    if (stSelect) stSelect.value = 'all';
    const plSelect = document.getElementById('horometer-filter-plan');
    if (plSelect) plSelect.value = 'all';
    const cySelect = document.getElementById('horometer-filter-cycle');
    if (cySelect) cySelect.value = 'all';
    const sortSelect = document.getElementById('horometer-sort-by');
    if (sortSelect) sortSelect.value = 'urgency';

    this.renderHorometersKPIs();
    this.renderMonthlyProjectionChart();
    this.filterAndRenderHorometers();
  }

  filterHorometersTable() {
    this.horometerSearch = document.getElementById('horometer-search-input')?.value || '';
    this.horometerStatusFilter = document.getElementById('horometer-filter-status')?.value || 'all';
    this.filterAndRenderHorometers();
  }

  filterAndRenderHorometers() {
    let list = [...(this.horometersData || [])];

    // 1. Búsqueda por cliente, modelo o serie
    if (this.horometerSearch) {
      const q = this.horometerSearch.toLowerCase().trim();
      list = list.filter(item => {
        const client = (item.client || '').toLowerCase();
        const api = (item.apiCode || '').toLowerCase();
        const model = (item.model || '').toLowerCase();
        const serial = (item.serialNumber || '').toLowerCase();
        return client.includes(q) || api.includes(q) || model.includes(q) || serial.includes(q);
      });
    }

    // 2. Filtro de Estado (AL DÍA, PRÓXIMO, VENCIDO, PENDIENTE DE DATOS)
    if (this.horometerStatusFilter && this.horometerStatusFilter !== 'all') {
      list = list.filter(item => {
        const itemStatus = (item.simplifiedStatus || '').toUpperCase();
        return itemStatus === this.horometerStatusFilter.toUpperCase();
      });
    }

    // 3. Ordenamiento: Priorizar VENCIDO -> PRÓXIMO -> AL DÍA -> PENDIENTE DE DATOS, luego cliente
    const statusPriority = {
      'VENCIDO': 1,
      'PRÓXIMO': 2,
      'AL DÍA': 3,
      'PENDIENTE DE DATOS': 4
    };

    list.sort((a, b) => {
      const prioA = statusPriority[(a.simplifiedStatus || '').toUpperCase()] || 5;
      const prioB = statusPriority[(b.simplifiedStatus || '').toUpperCase()] || 5;
      if (prioA !== prioB) return prioA - prioB;
      return (a.client || '').localeCompare(b.client || '');
    });

    // Actualizar contador
    const countBadge = document.getElementById('table-total-count-badge');
    if (countBadge) countBadge.textContent = `${list.length} equipo(s)`;

    this.renderHorometersTable(list);
    this.renderHorometersMobileCards(list);

    // Estado vacío
    const emptyEl = document.getElementById('horometers-empty-state');
    const tableEl = document.getElementById('horometers-table-el');
    const emptyMsg = document.getElementById('horometers-empty-message');
    if (emptyEl && tableEl) {
      if (list.length === 0) {
        emptyEl.style.display = 'block';
        tableEl.style.display = 'none';
        if (emptyMsg) {
          emptyMsg.textContent = this.horometerSearch
            ? `No se encontraron equipos para la búsqueda "${this.horometerSearch}".`
            : 'No hay equipos registrados para mostrar.';
        }
      } else {
        emptyEl.style.display = 'none';
        tableEl.style.display = 'table';
      }
    }
  }

  formatDateSpanish(dateStr) {
    if (!dateStr || dateStr === 'PENDIENTE DE DATOS') return 'PENDIENTE DE DATOS';
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
      return dateStr;
    } catch (e) {
      return dateStr;
    }
  }

  formatSimplifiedStatusBadge(status) {
    const st = (status || 'PENDIENTE DE DATOS').toUpperCase();
    if (st === 'AL DÍA' || st === 'AL DIA') {
      return '<span class="badge-status-horometer status-al-dia">● AL DÍA</span>';
    } else if (st === 'PRÓXIMO' || st === 'PROXIMO') {
      return '<span class="badge-status-horometer status-proximo">▲ PRÓXIMO</span>';
    } else if (st === 'VENCIDO') {
      return '<span class="badge-status-horometer status-vencido">✕ VENCIDO</span>';
    } else {
      return '<span class="badge-status-horometer status-pendiente-datos">○ PENDIENTE DE DATOS</span>';
    }
  }

  formatStatusBadge(item) {
    return this.formatSimplifiedStatusBadge(item.simplifiedStatus || item.status);
  }

  renderHorometersTable(list) {
    const tbody = document.getElementById('horometers-tbody');
    if (!tbody) return;

    if (list.length === 0) {
      tbody.innerHTML = '';
      return;
    }

    tbody.innerHTML = list.map(item => {
      // 1. CLIENTE
      const clientHtml = `
        <div class="eq-client-name" title="${item.client || '-'}">
          <strong>${item.client || '-'}</strong>
          ${item.isDemo ? '<span class="demo-tag-badge">DEMO</span>' : ''}
        </div>
      `;

      // 2. EQUIPO (Modelo + Serie / Identificación)
      const serialOrId = item.serialNumber ? `S/N: ${item.serialNumber}` : (item.apiCode ? `ID: ${item.apiCode}` : 'S/N');
      const equipHtml = `
        <div>
          <div class="eq-model-text" style="font-weight: 600; color: #031240;">${item.model || '-'}</div>
          <small style="color: #64748B; font-family: monospace;">${serialOrId}</small>
        </div>
      `;

      // 3. ÚLTIMO SERVICIO
      const lastServHtml = item.lastServiceDate
        ? `<span>${this.formatDateSpanish(item.lastServiceDate)}</span>`
        : '<span style="color: #94A3B8; font-style: italic;">PENDIENTE DE DATOS</span>';

      // 4. ÚLTIMO HORÓMETRO
      const lastHoroHtml = (item.lastHorometer !== null && item.lastHorometer !== undefined && item.lastHorometer !== '')
        ? `<span class="horometer-val">${Number(item.lastHorometer).toLocaleString()} hrs</span>`
        : '<span style="color: #94A3B8; font-style: italic;">PENDIENTE DE DATOS</span>';

      // 5. ÚLTIMO MANTENIMIENTO
      const lastMaintHtml = item.lastMaintenanceType
        ? `<span class="badge-last-service">${item.lastMaintenanceType}</span>`
        : '<span style="color: #94A3B8; font-style: italic;">PENDIENTE DE DATOS</span>';

      // 6. PRÓXIMO SERVICIO
      const nextServHtml = (item.nextServiceType && item.nextServiceType !== 'PENDIENTE DE CONFIGURACIÓN')
        ? `<span class="badge-next-service">${item.nextServiceType}</span>`
        : '<span style="color: #94A3B8; font-style: italic;">PENDIENTE DE CONFIGURACIÓN</span>';

      // 7. FECHA ESTIMADA (+3 meses calendario)
      const estDateHtml = item.estimatedDate
        ? `<strong>${this.formatDateSpanish(item.estimatedDate)}</strong>`
        : '<span style="color: #94A3B8; font-style: italic;">PENDIENTE DE DATOS</span>';

      // 8. ESTADO (AL DÍA, PRÓXIMO, VENCIDO, PENDIENTE DE DATOS)
      const statusHtml = this.formatSimplifiedStatusBadge(item.simplifiedStatus);

      // ACCIONES
      const actionsHtml = `
        <div class="horometer-actions-cell" style="justify-content: center; display: flex; gap: 4px;">
          <button type="button" class="btn-horometer-action btn-action-read" title="Registrar Lectura de Horómetro" onclick="window.app.openHorometerReadingModal('${item.id}')">
            ⏱️
          </button>
          <button type="button" class="btn-horometer-action btn-action-maint" title="Registrar Mantenimiento Realizado" onclick="window.app.openHorometerMaintenanceModal('${item.id}')">
            🔧
          </button>
          <button type="button" class="btn-horometer-action btn-action-config" title="Configurar Ciclo e Hitos de Mantenimiento" onclick="window.app.openHorometerConfigModal('${item.id}')">
            ⚙️
          </button>
          <button type="button" class="btn-horometer-action btn-action-hist" title="Ver Ficha Técnica e Historial" onclick="window.app.openHorometerHistoryModal('${item.id}')">
            📋
          </button>
          <button type="button" class="btn-horometer-action btn-action-delete" title="Borrar / Restablecer Horómetro o Eliminar Equipo" onclick="window.app.openDeleteHorometerModal('${item.id}')" style="color: #DC2626; border-color: #FCA5A5;">
            🗑️
          </button>
        </div>
      `;

      return `
        <tr>
          <td>${clientHtml}</td>
          <td>${equipHtml}</td>
          <td>${lastServHtml}</td>
          <td>${lastHoroHtml}</td>
          <td>${lastMaintHtml}</td>
          <td>${nextServHtml}</td>
          <td>${estDateHtml}</td>
          <td>${statusHtml}</td>
          <td style="text-align: center;">${actionsHtml}</td>
        </tr>
      `;
    }).join('');
  }

  renderHorometersMobileCards(list) {
    const container = document.getElementById('horometers-mobile-cards');
    if (!container) return;

    if (list.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = list.map(item => {
      const serialOrId = item.serialNumber ? `S/N: ${item.serialNumber}` : (item.apiCode ? `ID: ${item.apiCode}` : 'S/N');
      const lastServ = item.lastServiceDate ? this.formatDateSpanish(item.lastServiceDate) : 'PENDIENTE DE DATOS';
      const lastHoro = (item.lastHorometer !== null && item.lastHorometer !== undefined && item.lastHorometer !== '')
        ? `${Number(item.lastHorometer).toLocaleString()} hrs`
        : 'PENDIENTE DE DATOS';
      const lastMaint = item.lastMaintenanceType || 'PENDIENTE DE DATOS';
      const nextServ = item.nextServiceType || 'PENDIENTE DE CONFIGURACIÓN';
      const estDate = item.estimatedDate ? this.formatDateSpanish(item.estimatedDate) : 'PENDIENTE DE DATOS';

      return `
        <div class="horometer-mobile-card" style="background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <div class="mobile-card-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
            <div>
              <div style="font-weight: 700; color: #031240; font-size: 1rem;">
                ${item.client || '-'}
                ${item.isDemo ? '<span class="demo-tag-badge">DEMO</span>' : ''}
              </div>
              <div style="font-size: 0.85rem; color: #475569;">${item.model || '-'} • <small style="font-family: monospace;">${serialOrId}</small></div>
            </div>
            <div>
              ${this.formatSimplifiedStatusBadge(item.simplifiedStatus)}
            </div>
          </div>

          <div class="mobile-card-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; font-size: 0.82rem; margin-bottom: 0.75rem;">
            <div style="background: #F8FAFC; padding: 6px 8px; border-radius: 4px;">
              <span style="color: #64748B; display: block; font-size: 0.72rem; text-transform: uppercase;">Último Servicio</span>
              <strong>${lastServ}</strong>
            </div>
            <div style="background: #F8FAFC; padding: 6px 8px; border-radius: 4px;">
              <span style="color: #64748B; display: block; font-size: 0.72rem; text-transform: uppercase;">Último Horómetro</span>
              <strong>${lastHoro}</strong>
            </div>
            <div style="background: #F8FAFC; padding: 6px 8px; border-radius: 4px;">
              <span style="color: #64748B; display: block; font-size: 0.72rem; text-transform: uppercase;">Último Mantenimiento</span>
              <span class="badge-last-service" style="display: inline-block; margin-top: 2px;">${lastMaint}</span>
            </div>
            <div style="background: #F8FAFC; padding: 6px 8px; border-radius: 4px;">
              <span style="color: #64748B; display: block; font-size: 0.72rem; text-transform: uppercase;">Próximo Servicio</span>
              <span class="badge-next-service" style="display: inline-block; margin-top: 2px;">${nextServ}</span>
            </div>
            <div style="background: #F8FAFC; padding: 6px 8px; border-radius: 4px; grid-column: span 2;">
              <span style="color: #64748B; display: block; font-size: 0.72rem; text-transform: uppercase;">Fecha Estimada (+3 meses)</span>
              <strong style="color: #031240;">${estDate}</strong>
            </div>
          </div>

          <div class="mobile-card-actions" style="display: flex; gap: 6px; justify-content: flex-end;">
            <button type="button" class="btn btn-sm btn-outline-primary" onclick="window.app.openHorometerReadingModal('${item.id}')">
              ⏱️ Lectura
            </button>
            <button type="button" class="btn btn-sm btn-outline-success" onclick="window.app.openHorometerMaintenanceModal('${item.id}')">
              🔧 Mant.
            </button>
            <button type="button" class="btn btn-sm btn-outline-secondary" onclick="window.app.openHorometerConfigModal('${item.id}')">
              ⚙️ Config
            </button>
            <button type="button" class="btn btn-sm btn-secondary" onclick="window.app.openHorometerHistoryModal('${item.id}')">
              📋 Ficha
            </button>
            <button type="button" class="btn btn-sm btn-outline-danger" onclick="window.app.openDeleteHorometerModal('${item.id}')">
              🗑️ Borrar
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // --- MODAL 1: REGISTRAR LECTURA DE HORÓMETRO ---
  openHorometerReadingModal(equipmentId) {
    const eq = this.horometersData.find(e => e.id === equipmentId) || this.equipments.find(e => e.id === equipmentId);
    if (!eq) return;

    this.currentHorometerEquipment = eq;

    const setT = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val || '-';
    };

    setT('reading-modal-machine-tag', `${eq.client} — ${eq.model} [${eq.apiCode || 'S/C'}]`);
    setT('reading-client-name', eq.client);
    setT('reading-model-name', `${eq.model} (API: ${eq.apiCode || 'N/A'})`);
    setT('reading-current-hours', `${(eq.currentHours ?? eq.hours ?? 0).toLocaleString()} hrs`);

    const idInput = document.getElementById('reading-equipment-id');
    if (idInput) idInput.value = eq.id;

    const dateInput = document.getElementById('field-reading-date');
    if (dateInput) dateInput.value = getLocalDateString();

    const hoursInput = document.getElementById('field-new-reading-hours');
    if (hoursInput) {
      hoursInput.value = '';
      hoursInput.min = '0';
    }

    const userInput = document.getElementById('field-reading-user');
    if (userInput) userInput.value = '';

    const notesInput = document.getElementById('field-reading-notes');
    if (notesInput) notesInput.value = '';

    const warnBox = document.getElementById('reading-lower-warning');
    if (warnBox) warnBox.style.display = 'none';

    const chkConfirm = document.getElementById('chk-confirm-lower-reading');
    if (chkConfirm) chkConfirm.checked = false;

    const modal = document.getElementById('horometer-reading-modal');
    if (modal) modal.classList.add('active');

    setTimeout(() => hoursInput?.focus(), 150);
  }

  closeHorometerReadingModal() {
    const modal = document.getElementById('horometer-reading-modal');
    if (modal) modal.classList.remove('active');
    this.currentHorometerEquipment = null;
  }

  onReadingInputChanged() {
    const eq = this.currentHorometerEquipment;
    if (!eq) return;

    const hoursInput = document.getElementById('field-new-reading-hours');
    const warnBox = document.getElementById('reading-lower-warning');
    const warnMsg = document.getElementById('reading-lower-msg');
    if (!hoursInput || !warnBox) return;

    const currentH = Number(eq.currentHours ?? eq.hours ?? 0);
    const newH = parseFloat(hoursInput.value);

    if (!isNaN(newH) && newH < currentH) {
      warnBox.style.display = 'block';
      if (warnMsg) {
        warnMsg.textContent = `La lectura ingresada (${newH.toLocaleString()} hrs) es menor que la anterior (${currentH.toLocaleString()} hrs). Esto puede deberse a un reemplazo de horómetro o corrección técnica de digitación.`;
      }
    } else {
      warnBox.style.display = 'none';
      const chk = document.getElementById('chk-confirm-lower-reading');
      if (chk) chk.checked = false;
    }
  }

  async submitHorometerReading(e) {
    if (e) e.preventDefault();
    const eq = this.currentHorometerEquipment;
    if (!eq) return;

    const equipmentId = document.getElementById('reading-equipment-id')?.value;
    const hoursVal = parseFloat(document.getElementById('field-new-reading-hours')?.value);
    const dateVal = document.getElementById('field-reading-date')?.value || getLocalDateString();
    const userVal = document.getElementById('field-reading-user')?.value || '';
    const notesVal = document.getElementById('field-reading-notes')?.value || '';

    if (isNaN(hoursVal) || hoursVal < 0) {
      this.showToast('Por favor ingrese un horómetro válido (número positivo).', 'warning');
      return;
    }

    const currentH = Number(eq.currentHours ?? eq.hours ?? 0);

    // Validation for lower reading (Case I)
    if (hoursVal < currentH) {
      const chkConfirm = document.getElementById('chk-confirm-lower-reading')?.checked;
      if (!chkConfirm) {
        this.showToast('La nueva lectura es menor a la anterior. Debe marcar la casilla de confirmación para autorizar la corrección.', 'warning');
        return;
      }

      const confirmed = await this.showConfirmModal({
        title: 'Confirmar Corrección de Horómetro Menor',
        message: `Ha ingresado <strong>${hoursVal.toLocaleString()} hrs</strong>, lo cual es inferior a la lectura actual de <strong>${currentH.toLocaleString()} hrs</strong>.<br><br>¿Confirma que se trata de un reemplazo de horómetro o una corrección deliberada?`,
        confirmText: 'Sí, Aceptar Corrección',
        isDanger: true,
        icon: '⚠️'
      });

      if (!confirmed) return;
    }

    try {
      const res = await fetch(`/api/equipments/${equipmentId}/readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hours: hoursVal,
          date: dateVal,
          registeredBy: userVal,
          notes: notesVal
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al guardar lectura');

      this.showToast(`¡Lectura de ${hoursVal.toLocaleString()} hrs registrada exitosamente!`, 'success');
      this.closeHorometerReadingModal();

      await this.loadHorometersData();
      await this.loadEquipments();
    } catch (err) {
      console.error('Error registrando lectura:', err);
      this.showToast('Error al registrar lectura: ' + err.message, 'error');
    }
  }

  // --- MODAL 2: REGISTRAR MANTENIMIENTO REALIZADO ---
  openHorometerMaintenanceModal(equipmentId) {
    const eq = this.horometersData.find(e => e.id === equipmentId) || this.equipments.find(e => e.id === equipmentId);
    if (!eq) return;

    this.currentHorometerEquipment = eq;

    const setT = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val || '-';
    };

    setT('maint-modal-machine-tag', `${eq.client} — ${eq.model} [${eq.apiCode || 'S/C'}]`);

    const summaryInput = document.getElementById('maint-machine-summary');
    if (summaryInput) {
      summaryInput.value = `${eq.client} — ${eq.model} (API: ${eq.apiCode || 'N/A'}) • Horómetro Actual: ${(eq.currentHours ?? eq.hours ?? 0).toLocaleString()} hrs`;
    }

    const idInput = document.getElementById('maint-equipment-id');
    if (idInput) idInput.value = eq.id;

    const dateInput = document.getElementById('field-maint-date');
    if (dateInput) dateInput.value = getLocalDateString();

    const hoursInput = document.getElementById('field-maint-hours');
    if (hoursInput) {
      // Suggest next milestone or current hours
      hoursInput.value = eq.nextMilestoneHours || (eq.currentHours ?? eq.hours ?? 0);
    }

    const planSelect = document.getElementById('field-maint-plan');
    if (planSelect) {
      if (eq.nextPlan) {
        planSelect.value = eq.nextPlan;
      }
    }

    const reportNumInput = document.getElementById('field-maint-report-num');
    if (reportNumInput) reportNumInput.value = '';

    const notesInput = document.getElementById('field-maint-notes');
    if (notesInput) notesInput.value = '';

    const modal = document.getElementById('horometer-maintenance-modal');
    if (modal) modal.classList.add('active');
  }

  closeHorometerMaintenanceModal() {
    const modal = document.getElementById('horometer-maintenance-modal');
    if (modal) modal.classList.remove('active');
    this.currentHorometerEquipment = null;
  }

  async submitHorometerMaintenance(e) {
    if (e) e.preventDefault();
    const eq = this.currentHorometerEquipment;
    if (!eq) return;

    const equipmentId = document.getElementById('maint-equipment-id')?.value;
    const hoursVal = parseFloat(document.getElementById('field-maint-hours')?.value);
    const dateVal = document.getElementById('field-maint-date')?.value || getLocalDateString();
    const planVal = document.getElementById('field-maint-plan')?.value || 'Plan A — 2000 horas';
    const reportNumVal = document.getElementById('field-maint-report-num')?.value || '';
    const techVal = document.getElementById('field-maint-tech')?.value || '';
    const notesVal = document.getElementById('field-maint-notes')?.value || '';

    if (isNaN(hoursVal) || hoursVal < 0) {
      this.showToast('Por favor ingrese un horómetro de mantenimiento válido.', 'warning');
      return;
    }

    const confirmed = await this.showConfirmModal({
      title: 'Registrar Mantenimiento Ejecutado',
      message: `¿Desea registrar la ejecución de <strong>${planVal}</strong> a las <strong>${hoursVal.toLocaleString()} hrs</strong>?<br><br>💡 El sistema actualizará la última fecha de servicio y <strong>avanzará el ciclo de mantenimiento</strong> al próximo hito programado.`,
      confirmText: 'Confirmar Mantenimiento',
      isDanger: false,
      icon: '🔧'
    });

    if (!confirmed) return;

    try {
      const res = await fetch(`/api/equipments/${equipmentId}/maintenance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hours: hoursVal,
          date: dateVal,
          plan: planVal,
          reportNumber: reportNumVal,
          technician: techVal,
          notes: notesVal
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al registrar mantenimiento');

      this.showToast(`¡Mantenimiento ${planVal} registrado con éxito! Ciclo avanzado al próximo hito.`, 'success');
      this.closeHorometerMaintenanceModal();

      await this.loadHorometersData();
      await this.loadEquipments();
    } catch (err) {
      console.error('Error registrando mantenimiento:', err);
      this.showToast('Error al registrar mantenimiento: ' + err.message, 'error');
    }
  }

  // --- MODAL 3: CONFIGURACIÓN DE CICLO E HITOS ---
  openHorometerConfigModal(equipmentId) {
    const eq = this.horometersData.find(e => e.id === equipmentId) || this.equipments.find(e => e.id === equipmentId);
    if (!eq) return;

    this.currentHorometerEquipment = eq;

    const setT = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val || '-';
    };

    setT('config-modal-machine-tag', `Calibración técnica para: ${eq.client} — ${eq.model} [${eq.apiCode || 'S/C'}]`);
    setT('config-machine-title', `${eq.client} — ${eq.model} (API: ${eq.apiCode || 'N/A'})`);
    setT('config-machine-current-hours', `${(eq.currentHours ?? eq.hours ?? 0).toLocaleString()} hrs`);

    const idInput = document.getElementById('config-equipment-id');
    if (idInput) idInput.value = eq.id;

    const cycleSelect = document.getElementById('field-config-cycle');
    if (cycleSelect) cycleSelect.value = eq.cycleType || 'ciclo_2000';

    const lastDateInput = document.getElementById('field-config-last-date');
    if (lastDateInput) lastDateInput.value = eq.lastMaintDate || '';

    const lastHoursInput = document.getElementById('field-config-last-hours');
    if (lastHoursInput) lastHoursInput.value = eq.lastMaintHours ?? '';

    const lastPlanSelect = document.getElementById('field-config-last-plan');
    if (lastPlanSelect) lastPlanSelect.value = eq.lastPlan || '';

    const nextMilestoneInput = document.getElementById('field-config-next-milestone');
    if (nextMilestoneInput) nextMilestoneInput.value = eq.nextMilestoneHours ?? '';

    const nextPlanSelect = document.getElementById('field-config-next-plan');
    if (nextPlanSelect) nextPlanSelect.value = eq.nextPlan || 'Plan A — 2000 horas';

    const monthlyAvgInput = document.getElementById('field-config-monthly-avg');
    if (monthlyAvgInput) monthlyAvgInput.value = eq.monthlyAverageHours ?? '';

    const thresholdInput = document.getElementById('field-config-alert-threshold');
    if (thresholdInput) thresholdInput.value = eq.alertThresholdHours ?? 200;

    const modal = document.getElementById('horometer-config-modal');
    if (modal) modal.classList.add('active');
  }

  closeHorometerConfigModal() {
    const modal = document.getElementById('horometer-config-modal');
    if (modal) modal.classList.remove('active');
    this.currentHorometerEquipment = null;
  }

  onConfigCycleChanged(cycleType) {
    this.autoCalculateNextMilestoneFromConfig();
  }

  autoCalculateNextMilestoneFromConfig() {
    const cycle = document.getElementById('field-config-cycle')?.value || 'ciclo_2000';
    const lastHoursVal = parseFloat(document.getElementById('field-config-last-hours')?.value);
    const nextMilestoneInput = document.getElementById('field-config-next-milestone');
    const nextPlanSelect = document.getElementById('field-config-next-plan');

    if (isNaN(lastHoursVal)) return;

    const step = cycle === 'ciclo_3000' ? 3000 : 2000;
    const nextMilestone = Math.floor(lastHoursVal / step) * step + step;

    if (nextMilestoneInput && (!nextMilestoneInput.value || parseFloat(nextMilestoneInput.value) <= lastHoursVal)) {
      nextMilestoneInput.value = nextMilestone;
    }

    if (nextPlanSelect) {
      if (cycle === 'ciclo_3000') {
        const mod12k = nextMilestone % 12000;
        if (mod12k === 0) nextPlanSelect.value = 'Plan C — 12000 horas';
        else if (mod12k === 6000) nextPlanSelect.value = 'Plan B — 6000 horas';
        else nextPlanSelect.value = 'Plan A — 3000 horas';
      } else {
        const mod8k = nextMilestone % 8000;
        if (mod8k === 0) nextPlanSelect.value = 'Plan C — 8000 horas';
        else if (mod8k === 4000) nextPlanSelect.value = 'Plan B — 4000 horas';
        else nextPlanSelect.value = 'Plan A — 2000 horas';
      }
    }
  }

  async submitHorometerConfig(e) {
    if (e) e.preventDefault();
    const equipmentId = document.getElementById('config-equipment-id')?.value;
    if (!equipmentId) return;

    const cycleType = document.getElementById('field-config-cycle')?.value || 'ciclo_2000';
    const lastDate = document.getElementById('field-config-last-date')?.value || null;
    const lastHours = document.getElementById('field-config-last-hours')?.value ? parseFloat(document.getElementById('field-config-last-hours').value) : null;
    const lastPlan = document.getElementById('field-config-last-plan')?.value || null;
    const nextMilestoneHours = document.getElementById('field-config-next-milestone')?.value ? parseFloat(document.getElementById('field-config-next-milestone').value) : null;
    const nextPlan = document.getElementById('field-config-next-plan')?.value || null;
    const monthlyAverageHours = document.getElementById('field-config-monthly-avg')?.value ? parseFloat(document.getElementById('field-config-monthly-avg').value) : null;
    const alertThresholdHours = document.getElementById('field-config-alert-threshold')?.value ? parseFloat(document.getElementById('field-config-alert-threshold').value) : 200;

    try {
      const res = await fetch(`/api/equipments/${equipmentId}/maintenance-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cycleType,
          lastMaintDate: lastDate,
          lastMaintHours: lastHours,
          lastPlan,
          nextMilestoneHours,
          nextPlan,
          monthlyAverageHours,
          alertThresholdHours
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al guardar configuración');

      this.showToast('Configuración de ciclo e hitos guardada exitosamente.', 'success');
      this.closeHorometerConfigModal();

      await this.loadHorometersData();
      await this.loadEquipments();
    } catch (err) {
      console.error('Error guardando config:', err);
      this.showToast('Error al guardar configuración: ' + err.message, 'error');
    }
  }

  // --- MODAL 4: HISTORIAL DE HORÓMETROS E INTERVENCIONES ---
  async openHorometerHistoryModal(equipmentId) {
    const eq = this.horometersData.find(e => e.id === equipmentId) || this.equipments.find(e => e.id === equipmentId);
    if (!eq) return;

    const setT = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val || '-';
    };

    setT('history-modal-machine-tag', `${eq.client} — ${eq.model} [${eq.apiCode || 'S/C'}]`);
    setT('hist-stat-client', `${eq.client} ${eq.isDemo ? '(DEMO)' : ''}`);
    setT('hist-stat-model', `${eq.model} (API: ${eq.apiCode || 'N/A'}${eq.serialNumber ? ' · S/N: ' + eq.serialNumber : ''})`);
    setT('hist-stat-hours', `${(eq.currentHours ?? eq.hours ?? 0).toLocaleString()} hrs`);
    setT('hist-stat-cycle', (eq.cycleType === 'ciclo_3000' || eq.cycle === 'ciclo_3000') ? '⭐ Ciclo Especial (3k/6k/12k)' : '⚙️ Ciclo Estándar (2k/4k/8k)');
    setT('hist-stat-next-plan', eq.nextPlan ? `${eq.nextPlan} (${(eq.nextMilestoneHours ?? 0).toLocaleString()} hrs)` : 'Pendiente');

    let hoursRemText = '-';
    if (eq.hoursRemaining !== null && eq.hoursRemaining !== undefined) {
      if (eq.hoursRemaining <= 0) {
        hoursRemText = `⚠️ Vencido por ${Math.abs(eq.hoursRemaining).toLocaleString()} hrs`;
      } else {
        hoursRemText = `${eq.hoursRemaining.toLocaleString()} hrs restantes`;
      }
    }
    setT('hist-stat-hours-remaining', hoursRemText);

    let quarterlyText = '-';
    if (eq.quarterlyEstimatedDate) {
      quarterlyText = this.formatDateSpanish(eq.quarterlyEstimatedDate);
      if (eq.daysToQuarterly !== null && eq.daysToQuarterly !== undefined) {
        if (eq.daysToQuarterly < 0) quarterlyText += ` (Vencido hace ${Math.abs(eq.daysToQuarterly)} d)`;
        else quarterlyText += ` (En ${eq.daysToQuarterly} días)`;
      }
    }
    setT('hist-stat-quarterly-date', quarterlyText);

    const badgeEl = document.getElementById('hist-stat-status-badge');
    if (badgeEl) badgeEl.innerHTML = this.formatStatusBadge(eq);

    const alertReasonEl = document.getElementById('hist-stat-alert-reason');
    const alertIconEl = document.getElementById('hist-stat-alert-icon');
    const alertBoxEl = document.getElementById('hist-stat-alert-box');
    if (alertReasonEl) alertReasonEl.textContent = eq.alertReason || 'Operación en parámetros normales de mantenimiento.';
    if (alertIconEl) alertIconEl.textContent = eq.statusIcon || 'ℹ️';
    if (alertBoxEl) {
      alertBoxEl.className = 'sheet-alert-callout';
      if (eq.status?.startsWith('overdue')) alertBoxEl.classList.add('callout-red');
      else if (eq.status?.startsWith('upcoming')) alertBoxEl.classList.add('callout-amber');
      else if (eq.status === 'up_to_date') alertBoxEl.classList.add('callout-green');
      else alertBoxEl.classList.add('callout-slate');
    }

    const tbody = document.getElementById('horometer-history-tbody');
    const emptyBox = document.getElementById('horometer-history-empty');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 2rem;">Cargando historial...</td></tr>';
    if (emptyBox) emptyBox.style.display = 'none';

    const modal = document.getElementById('horometer-history-modal');
    if (modal) modal.classList.add('active');

    try {
      const res = await fetch(`/api/equipments/${equipmentId}/horometer-history`);
      if (!res.ok) throw new Error('Error al obtener historial');
      const timeline = await res.json();

      if (!timeline || timeline.length === 0) {
        if (tbody) tbody.innerHTML = '';
        if (emptyBox) emptyBox.style.display = 'block';
        return;
      }

      if (emptyBox) emptyBox.style.display = 'none';
      if (tbody) {
        tbody.innerHTML = timeline.map(entry => {
          let badgeHtml = '';
          if (entry.type === 'maintenance') {
            badgeHtml = '<span class="timeline-badge badge-maint">🔧 Mantenimiento</span>';
          } else if (entry.type === 'reading') {
            badgeHtml = '<span class="timeline-badge badge-read">⏱️ Lectura</span>';
          } else {
            badgeHtml = '<span class="timeline-badge badge-init">⚙️ Config / Inicial</span>';
          }

          return `
            <tr>
              <td><strong>${this.formatDateSpanish(entry.date)}</strong></td>
              <td><span class="timeline-reading-highlight">${(entry.hours ?? 0).toLocaleString()} hrs</span></td>
              <td>${badgeHtml}</td>
              <td><strong>${entry.plan || '-'}</strong></td>
              <td>${entry.reportNumber ? `<span class="eq-id-badge" style="font-size: 0.76rem;">${entry.reportNumber}</span>` : '-'}</td>
              <td>${entry.technician || entry.registeredBy || '-'}</td>
              <td style="color: #475569; font-size: 0.8rem; max-width: 220px; overflow: hidden; text-overflow: ellipsis;">
                ${entry.notes || '-'}
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (err) {
      console.error('Error cargando historial de horómetro:', err);
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="color: red; text-align: center;">Error: ${err.message}</td></tr>`;
    }
  }

  closeHorometerHistoryModal() {
    const modal = document.getElementById('horometer-history-modal');
    if (modal) modal.classList.remove('active');
  }

  // --- MODAL: GESTIÓN DE BORRADO EN SECCIÓN DE HORÓMETROS ---
  openDeleteHorometerModal(equipmentId) {
    const eq = this.horometersData.find(e => e.id === equipmentId) || this.equipments.find(e => e.id === equipmentId);
    if (!eq) return;

    this.currentHorometerEquipment = eq;

    const modal = document.getElementById('delete-horometer-modal');
    if (!modal) return;

    const eqIdEl = document.getElementById('delete-horo-eq-id');
    if (eqIdEl) eqIdEl.value = eq.id;

    const clientEl = document.getElementById('delete-horo-client-text');
    if (clientEl) clientEl.textContent = eq.client || '-';

    const serialOrId = eq.serialNumber ? `S/N: ${eq.serialNumber}` : (eq.apiCode ? `ID: ${eq.apiCode}` : 'S/N');
    const modelEl = document.getElementById('delete-horo-model-text');
    if (modelEl) modelEl.textContent = `${eq.model || 'Compresor'} • ${serialOrId}`;

    const horoVal = (eq.lastHorometer !== null && eq.lastHorometer !== undefined && eq.lastHorometer !== '')
      ? `${Number(eq.lastHorometer).toLocaleString()} hrs`
      : ((eq.hourMeter !== null && eq.hourMeter !== undefined && eq.hourMeter !== '') ? `${Number(eq.hourMeter).toLocaleString()} hrs` : 'Pendiente de datos');
    const hoursEl = document.getElementById('delete-horo-hours-text');
    if (hoursEl) hoursEl.textContent = horoVal;

    modal.classList.add('active');
  }

  closeDeleteHorometerModal() {
    const modal = document.getElementById('delete-horometer-modal');
    if (modal) modal.classList.remove('active');
  }

  async confirmResetHorometer() {
    const eqIdEl = document.getElementById('delete-horo-eq-id');
    const eqId = eqIdEl ? eqIdEl.value : null;
    if (!eqId) return;

    this.closeDeleteHorometerModal();

    const confirmed = await this.showConfirmModal({
      title: 'Restablecer Horómetro',
      message: '¿Está seguro de restablecer el horómetro y borrar el historial de lecturas de este equipo?<br><br><span style="color: var(--color-text-muted); font-size: 0.85rem;">El equipo se conservará en el catálogo y su estado pasará a <strong>PENDIENTE DE DATOS</strong>.</span>',
      confirmText: '🔄 Sí, Restablecer Horómetro',
      cancelText: 'Cancelar',
      isDanger: false,
      icon: '🔄'
    });

    if (!confirmed) return;

    try {
      this.showToast('Restableciendo horómetro del equipo...', 'info');
      const res = await fetch(`/api/equipments/${encodeURIComponent(eqId)}/horometer`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success !== false) {
        this.showToast('Horómetro restablecido a Pendiente de Datos exitosamente.', 'success');
        await this.loadHorometersData();
        await this.loadEquipments();
      } else {
        throw new Error(data.error || 'Error al restablecer horómetro');
      }
    } catch (e) {
      console.error('Error al restablecer horómetro:', e);
      this.showToast('No se pudo restablecer el horómetro: ' + e.message, 'error');
    }
  }

  async confirmDeleteEquipmentFromHorometer() {
    const eqIdEl = document.getElementById('delete-horo-eq-id');
    const eqId = eqIdEl ? eqIdEl.value : null;
    if (!eqId) return;

    this.closeDeleteHorometerModal();

    const eq = this.equipments.find(e => e.id === eqId) || this.horometersData.find(e => e.id === eqId);
    const eqName = eq ? `${eq.model || 'Compresor'} (${eq.apiCode || eq.serialNumber || 'S/N'})` : 'este compresor';

    const confirmed = await this.showConfirmModal({
      title: 'Eliminar Equipo Permanentemente',
      message: `¿Está seguro de eliminar <strong>${eqName}</strong> por completo del sistema?<br><br><span style="color: #DC2626; font-size: 0.85rem; font-weight: 600;">Esta acción removerá el equipo tanto del catálogo como del tablero de horómetros y próximos mantenimientos.</span>`,
      confirmText: '🗑️ Sí, Eliminar Equipo',
      cancelText: 'Cancelar',
      isDanger: true,
      icon: '🗑️'
    });

    if (!confirmed) return;

    try {
      this.showToast('Eliminando equipo del sistema...', 'info');
      const res = await fetch(`/api/equipments/${encodeURIComponent(eqId)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        this.showToast('Equipo eliminado exitosamente.', 'success');
        await this.loadHorometersData();
        await this.loadEquipments();
        await this.loadClients();
      } else {
        throw new Error(data.error || 'Error al eliminar el equipo');
      }
    } catch (e) {
      console.error('Error al eliminar equipo:', e);
      this.showToast('No se pudo eliminar el equipo: ' + e.message, 'error');
    }
  }
}

