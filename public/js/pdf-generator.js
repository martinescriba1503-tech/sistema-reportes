/**
 * INDUSTRAC S.A.C. — Generador Profesional de Reportes Técnicos en PDF
 * Utiliza jsPDF y jsPDF-AutoTable con diseño corporativo de alta ingeniería
 */
class IndustracPdfGenerator {
  constructor() {
    this.colors = {
      primaryDark: [3, 18, 64],    // #031240
      primary: [5, 26, 89],        // #051A59
      accent: [24, 162, 217],      // #18A2D9
      accentAlt: [20, 181, 217],   // #14B5D9
      grayLight: [242, 242, 242],  // #F2F2F2
      grayBg: [248, 250, 252],
      grayBorder: [226, 232, 240],
      textDark: [15, 23, 42],
      textMuted: [100, 116, 139],
      white: [255, 255, 255],
      success: [16, 185, 129],
      warning: [245, 158, 11],     // #F59E0B (Naranja / Medio)
      danger: [239, 68, 68]
    };

    this.logoImg = null;
    if (typeof Image !== 'undefined') {
      try {
        this.logoImg = new Image();
        this.logoImg.src = 'assets/logo.png';
      } catch (e) {}
    }
  }

  // Draw corporate logo to dataURL on canvas using new Industrac emblem
  generateLogoDataUrl() {
    const canvas = document.createElement('canvas');
    canvas.width = 340;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');

    // Transparent / clean background
    ctx.clearRect(0, 0, 340, 100);

    const logoImg = (this.logoImg && this.logoImg.complete && this.logoImg.naturalWidth > 0)
      ? this.logoImg
      : document.getElementById('corp-logo-img');
    let drewImg = false;
    if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
      try {
        ctx.save();
        ctx.beginPath();
        ctx.arc(50, 50, 44, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(logoImg, 6, 6, 88, 88);
        ctx.restore();
        drewImg = true;
      } catch (e) {
        console.warn('Error dibujando logo en canvas:', e);
      }
    }

    if (!drewImg) {
      // Fallback: Circular blue badge
      ctx.fillStyle = '#005CB9';
      ctx.beginPath();
      ctx.arc(50, 50, 44, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(50, 50, 24, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#005CB9';
      ctx.beginPath();
      ctx.arc(50, 50, 14, 0, Math.PI * 2);
      ctx.fill();
    }

    // Typography: INDUSTRAC S.A.C.
    ctx.fillStyle = '#031240';
    ctx.font = '900 29px sans-serif';
    ctx.fillText('INDUSTRAC', 105, 47);

    ctx.fillStyle = '#005CB9';
    ctx.font = '700 16px sans-serif';
    ctx.fillText('S.A.C.', 282, 37);

    // Subtitle
    ctx.fillStyle = '#64748B';
    ctx.font = '600 9.5px sans-serif';
    ctx.fillText('COMPRESORES DE AIRE & SERVICIOS INDUSTRIALES', 105, 66);

    return canvas.toDataURL('image/png');
  }

  async generatePdf(report) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('La librería jsPDF no está cargada.');
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
    const pageHeight = doc.internal.pageSize.getHeight(); // 297mm
    const margin = 12;
    const contentWidth = pageWidth - margin * 2; // 186mm
    let currentY = margin;

    // --- ENCABEZADO CORPORATIVO (PÁGINA 1) ---
    const logoUrl = this.generateLogoDataUrl();
    doc.addImage(logoUrl, 'PNG', margin, currentY, 56, 17.5);

    // Info de contacto INDUSTRAC (esquina superior derecha)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...this.colors.textMuted);
    const companyLines = [
      'INDUSTRAC S.A.C. - RUC: 20524154626',
      'Servicio Técnico Autorizado Multimarca',
      'Cel: +51 969 195 015',
      'ventas@industrac.pe | www.industrac.com'
    ];
    doc.text(companyLines, pageWidth - margin, currentY + 3, { align: 'right' });

    currentY += 21;

    // Barra de título del Reporte
    doc.setFillColor(...this.colors.primaryDark);
    doc.roundedRect(margin, currentY, contentWidth, 12, 1.5, 1.5, 'F');

    // Acento decorativo celeste
    doc.setFillColor(...this.colors.accent);
    doc.rect(margin, currentY, 3, 12, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...this.colors.white);
    doc.text('REPORTE TÉCNICO DE MANTENIMIENTO DE COMPRESOR', margin + 6, currentY + 7.5);

    // Número de reporte y Estado
    const validReportNumber = (report.reportNumber && report.reportNumber !== 'AUTO') ? report.reportNumber : 'REP-2026-0001';
    const reportNumText = `N° ${validReportNumber}`;
    doc.setFontSize(10);
    doc.text(reportNumText, pageWidth - margin - 38, currentY + 7.5);

    // Badge de estado
    const status = report.status || 'Finalizado';
    let badgeColor = this.colors.success;
    if (status === 'Borrador') badgeColor = [245, 158, 11];
    if (status === 'Pendiente de revisión') badgeColor = this.colors.accent;

    doc.setFillColor(...badgeColor);
    doc.roundedRect(pageWidth - margin - 34, currentY + 2.5, 32, 7, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...this.colors.white);
    doc.text(status.toUpperCase(), pageWidth - margin - 18, currentY + 7, { align: 'center' });

    currentY += 15;

    // --- SECCIÓN 1: DATOS GENERALES Y DEL EQUIPO ---
    const is2000Maint = (report.maintenanceType || '').includes('2000') || /plan\s*a/i.test(report.maintenanceType || '');
    let displayOilType = 'No aplica';
    if (!is2000Maint && report.oilType && report.oilType !== 'No aplica') {
      displayOilType = report.oilType === 'Otro' ? `Otro: ${report.customOil || ''}` : report.oilType;
    }

    const generalDataRows = [
      [
        { content: 'Cliente / Compañía:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
        { content: report.client || 'N/A' },
        { content: 'Fecha del Servicio:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
        { content: report.date || (typeof getLocalDateString === 'function' ? getLocalDateString() : new Date().toLocaleDateString('en-CA')) }
      ],
      [
        { content: 'Dirección del Servicio:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
        { content: report.address || 'N/A' },
        { content: 'Técnico Responsable:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
        { content: report.technician || 'N/A' }
      ],
      [
        { content: 'Tipo de Servicio:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
        { content: report.serviceType || 'Mantenimiento' },
        { content: 'Tipo de Mantenimiento:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
        { content: report.maintenanceType || 'Plan A — 2000 horas' }
      ],
      [
        { content: 'Modelo del Compresor:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
        { content: report.model || 'N/A' },
        { content: 'API / ID Máquina:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
        { content: report.apiCode || report.serialNumber || 'N/A' }
      ],
      [
        { content: 'Controlador / Módulo:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
        { content: report.controller || 'N/A' },
        { content: 'Horómetro Actual:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
        { content: `${report.hourMeter || '0'} hrs` }
      ],
      [
        { content: 'Presión Nominal / Setpoint:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
        { content: report.pressure || 'N/A' },
        { content: 'Caudal del Equipo:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
        { content: report.airflow || 'N/A' }
      ],
      [
        { content: 'Tipo de Aceite:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
        { content: displayOilType },
        { content: 'Nivel de Aceite:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
        this.getOilLevelPdfCell(report.oilLevel || 'Alto')
      ],
      [
        { content: 'Fabricante de Origen:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
        { content: report.manufacturer || 'Atlas Copco', colSpan: 3 }
      ]
    ];

    let sectionIndex = 1;

    doc.autoTable({
      startY: currentY,
      margin: { left: margin, right: margin },
      head: [[{ content: `${sectionIndex++}. DATOS GENERALES Y ESPECIFICACIONES DEL EQUIPO`, colSpan: 4, styles: { fillColor: this.colors.primary, textColor: this.colors.white, fontStyle: 'bold' } }]],
      body: generalDataRows,
      theme: 'grid',
      styles: {
        fontSize: 7.8,
        cellPadding: 1.8,
        textColor: this.colors.textDark,
        lineColor: this.colors.grayBorder,
        lineWidth: 0.2
      },
      columnStyles: {
        0: { cellWidth: 42 },
        1: { cellWidth: 51 },
        2: { cellWidth: 42 },
        3: { cellWidth: 51 }
      }
    });

    currentY = doc.lastAutoTable.finalY + 4;

    // --- SECCIÓN 2: TRABAJOS MECÁNICOS EFECTUADOS ---
    const allTasksMaster = [
      { id: 'filtro_aceite', name: '1 Filtro de Aceite' },
      { id: 'filtro_aire', name: '1 Filtro de Aire' },
      { id: 'filtro_separador', name: '1 Filtro Separador' },
      { id: 'cambio_aceite', name: 'Aceite Roto Xtend (5 L / 20 L)' },
      { id: 'valvula_termostatica', name: 'Kit de válvula termostática' },
      { id: 'valvula_minima_presion', name: 'Kit de válvula de mínima presión' },
      { id: 'kits_drenaje_ld20', name: 'Kits de drenaje LD20' },
      { id: 'valvula_admision', name: 'Mantenimiento de válvula de admisión' },
      { id: 'valvula_check', name: 'Mantenimiento de válvula check' },
      { id: 'valvula_oilstop', name: 'Mantenimiento de válvula oilstop' },
      { id: 'trampa_agua', name: 'Mantenimiento de trampa de agua' },
      { id: 'check_barrido', name: 'Cambio de check de barrido' },
      { id: 'limpieza_enfriador', name: 'Limpieza de enfriador' },
      { id: 'lavado_quimico_enfriador', name: 'Lavado químico de enfriador' },
      { id: 'ajuste_tablero', name: 'Ajuste de tablero eléctrico' },
      { id: 'otros_trabajos', name: 'Otros trabajos' }
    ];

    const executedTasks = report.mechanicalTasks || {};

    const getTaskDisplayName = (t) => {
      if (!t) return '';
      if (t.id === 'cambio_aceite' && report.oilQuantities && (report.oilQuantities['20 L'] > 0 || report.oilQuantities['5 L'] > 0)) {
        const q20 = report.oilQuantities['20 L'] || 0;
        const q5 = report.oilQuantities['5 L'] || 0;
        const parts = [];
        if (q20 > 0) parts.push(`${q20}x 20L`);
        if (q5 > 0) parts.push(`${q5}x 5L`);
        return `Aceite (${parts.join(' + ')} = ${(q20 * 20) + (q5 * 5)}L)`;
      }
      return t.name;
    };

    // Build 2-column matrix
    const half = Math.ceil(allTasksMaster.length / 2);
    const taskRows = [];
    for (let i = 0; i < half; i++) {
      const task1 = allTasksMaster[i];
      const task2 = allTasksMaster[i + half];

      const isChecked1 = !!executedTasks[task1.id];
      const isChecked2 = task2 ? !!executedTasks[task2.id] : false;

      taskRows.push([
        { content: isChecked1 ? '[✓]' : '[  ]', styles: { halign: 'center', fontStyle: 'bold', textColor: isChecked1 ? this.colors.success : this.colors.textMuted } },
        { content: getTaskDisplayName(task1), styles: { fontStyle: isChecked1 ? 'bold' : 'normal' } },
        { content: isChecked1 ? 'EJECUTADO' : 'NO REALIZADO', styles: { fontStyle: 'bold', textColor: isChecked1 ? this.colors.success : this.colors.textMuted } },
        { content: task2 ? (isChecked2 ? '[✓]' : '[  ]') : '', styles: { halign: 'center', fontStyle: 'bold', textColor: isChecked2 ? this.colors.success : this.colors.textMuted } },
        { content: task2 ? getTaskDisplayName(task2) : '', styles: { fontStyle: isChecked2 ? 'bold' : 'normal' } },
        { content: task2 ? (isChecked2 ? 'EJECUTADO' : 'NO REALIZADO') : '', styles: { fontStyle: 'bold', textColor: isChecked2 ? this.colors.success : this.colors.textMuted } }
      ]);
    }

    if (report.otherMechanicalTasks) {
      taskRows.push([
        { content: 'TRABAJOS ADICIONALES:', colSpan: 2, styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
        { content: report.otherMechanicalTasks, colSpan: 4 }
      ]);
    }

    if (report.pendingTasksReason) {
      taskRows.push([
        { content: 'JUSTIFICACIÓN TAREAS PENDIENTES:', colSpan: 2, styles: { fontStyle: 'bold', fillColor: this.colors.grayBg, textColor: this.colors.danger } },
        { content: report.pendingTasksReason, colSpan: 4 }
      ]);
    }

    doc.autoTable({
      startY: currentY,
      margin: { left: margin, right: margin },
      head: [
        [{ content: `${sectionIndex++}. TRABAJOS MECÁNICOS Y PROTOCOLO DE MANTENIMIENTO`, colSpan: 6, styles: { fillColor: this.colors.primary, textColor: this.colors.white, fontStyle: 'bold' } }],
        [
          { content: 'St.', styles: { halign: 'center', cellWidth: 8 } },
          { content: 'Actividad Técnica', styles: { cellWidth: 54 } },
          { content: 'Condición', styles: { cellWidth: 31 } },
          { content: 'St.', styles: { halign: 'center', cellWidth: 8 } },
          { content: 'Actividad Técnica', styles: { cellWidth: 54 } },
          { content: 'Condición', styles: { cellWidth: 31 } }
        ]
      ],
      body: taskRows,
      theme: 'grid',
      styles: {
        fontSize: 7.2,
        cellPadding: 1.5,
        textColor: this.colors.textDark,
        lineColor: this.colors.grayBorder,
        lineWidth: 0.2
      }
    });

    currentY = doc.lastAutoTable.finalY + 4;

    // --- SECCIÓN: MEDICIONES ELÉCTRICAS Y MOTORES (OPCIONAL) ---
    const elec = report.electrical || {};
    const motor = report.mainMotor || {};
    const fan = report.fanMotor || {};
    const hasElectrical = !!(
      report.hasElectrical ||
      (report.hasElectrical !== false && (
        (elec.u1_u2 && elec.u1_u2 !== 'N/M') ||
        (elec.i_l1 && elec.i_l1 !== 'N/M') ||
        (elec.ground && elec.ground !== 'N/M') ||
        (motor.voltage && motor.voltage !== 'N/M') ||
        (motor.amperage && motor.amperage !== 'N/M')
      ))
    );

    if (hasElectrical) {
      const elecRows = [
        [
          { content: 'Voltajes de Línea:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
          { content: `UL1-UL2: ${elec.u1_u2 || 'N/M'} V` },
          { content: `UL2-UL3: ${elec.u2_u3 || 'N/M'} V` },
          { content: `UL1-UL3: ${elec.u1_u3 || 'N/M'} V` }
        ],
        [
          { content: 'Amperajes de Línea:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
          { content: `L1: ${elec.i_l1 || 'N/M'} A` },
          { content: `L2: ${elec.i_l2 || 'N/M'} A` },
          { content: `L3: ${elec.i_l3 || 'N/M'} A` }
        ],
        [
          { content: 'Fusibles / Fases F:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
          { content: `F1: ${elec.f1 || 'N/A'} A` },
          { content: `F2: ${elec.f2 || 'N/A'} A` },
          { content: `F3: ${elec.f3 || 'N/A'} A` }
        ],
        [
          { content: 'Línea de Tierra:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
          { content: elec.ground || 'N/M', colSpan: 3 }
        ],
        [
          { content: 'Motor Eléctrico Principal:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
          { content: `Marca: ${motor.brand || 'N/A'}` },
          { content: `Voltaje: ${motor.voltage || 'N/M'} V | Amperaje: ${motor.amperage || 'N/M'} A` },
          { content: `FS: ${motor.fs || '1.15'} | Prot: ${motor.protection || 'IP55'}` }
        ],
        [
          { content: 'Motor Ventilador:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
          { content: `Voltaje: ${fan.voltage || 'N/M'} V` },
          { content: `Amperaje: ${fan.amperage || 'N/M'} A` },
          { content: `FS: ${fan.fs || '1.0'} | Prot: ${fan.protection || 'IP54'}` }
        ]
      ];

      doc.autoTable({
        startY: currentY,
        margin: { left: margin, right: margin },
        head: [[{ content: `${sectionIndex++}. MEDICIONES ELÉCTRICAS Y CONDICIONES DE MOTORES`, colSpan: 4, styles: { fillColor: this.colors.primary, textColor: this.colors.white, fontStyle: 'bold' } }]],
        body: elecRows,
        theme: 'grid',
        styles: {
          fontSize: 7.2,
          cellPadding: 1.6,
          textColor: this.colors.textDark,
          lineColor: this.colors.grayBorder,
          lineWidth: 0.2
        },
        columnStyles: {
          0: { cellWidth: 42 },
          1: { cellWidth: 48 },
          2: { cellWidth: 48 },
          3: { cellWidth: 48 }
        }
      });

      currentY = doc.lastAutoTable.finalY + 4;
    }

    // --- SECCIÓN 4: DATOS DEL SECADOR (SI APLICA) ---
    if (report.hasDryer) {
      const dryer = report.dryer || {};
      const dryerRows = [
        [
          { content: 'Modelo del Secador:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
          { content: dryer.model || 'N/A' },
          { content: 'Número de Serie:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
          { content: dryer.serialNumber || 'N/A' }
        ],
        [
          { content: 'Punto de Rocío (Dew Point):', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
          { content: `${dryer.dewPoint || '3'} °C` },
          { content: 'Voltaje / Amperaje:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
          { content: `${dryer.voltage || 'N/M'} V / ${dryer.amperage || 'N/M'} A` }
        ],
        [
          { content: 'Tipo de Refrigerante:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
          { content: dryer.refrigerant || 'R134a' },
          { content: 'Protección / Limpieza:', styles: { fontStyle: 'bold', fillColor: this.colors.grayBg } },
          { content: `Prot: ${dryer.protection || 'OK'} | Limpieza: ${dryer.cleaning || 'OK'}` }
        ]
      ];

      doc.autoTable({
        startY: currentY,
        margin: { left: margin, right: margin },
        head: [[{ content: `${sectionIndex++}. DATOS Y MEDICIONES DEL SECADOR DE AIRE`, colSpan: 4, styles: { fillColor: this.colors.primary, textColor: this.colors.white, fontStyle: 'bold' } }]],
        body: dryerRows,
        theme: 'grid',
        styles: {
          fontSize: 7.2,
          cellPadding: 1.5,
          textColor: this.colors.textDark,
          lineColor: this.colors.grayBorder,
          lineWidth: 0.2
        },
        columnStyles: {
          0: { cellWidth: 42 },
          1: { cellWidth: 51 },
          2: { cellWidth: 42 },
          3: { cellWidth: 51 }
        }
      });

      currentY = doc.lastAutoTable.finalY + 4;
    }

    // --- SECCIÓN 5: PARÁMETROS TÉCNICOS Y REGULACIONES ---
    const lives = report.serviceLives || {};
    const regs = report.regulations || {};
    const params = report.technicalParameters || {};

    const paramsRows = [
      [
        { content: 'VIDA DE SERVICIOS PROGRAMADOS', colSpan: 2, styles: { fontStyle: 'bold', fillColor: this.colors.grayBg, halign: 'center' } },
        { content: 'REGULACIONES Y OPERACIÓN', colSpan: 2, styles: { fontStyle: 'bold', fillColor: this.colors.grayBg, halign: 'center' } }
      ],
      [
        { content: 'Vida Aceite:', styles: { fontStyle: 'bold' } },
        { content: `${lives.oilLife || '0'} hrs` },
        { content: 'Presión de Carga:', styles: { fontStyle: 'bold' } },
        { content: `${regs.loadPressure || 'N/M'} bar` }
      ],
      [
        { content: 'Vida Filtro de Aceite:', styles: { fontStyle: 'bold' } },
        { content: `${lives.oilFilterLife || '0'} hrs` },
        { content: 'Presión de Descarga:', styles: { fontStyle: 'bold' } },
        { content: `${regs.unloadPressure || 'N/M'} bar` }
      ],
      [
        { content: 'Vida Filtro de Aire:', styles: { fontStyle: 'bold' } },
        { content: `${lives.airFilterLife || '0'} hrs` },
        { content: 'Punto Ajuste VSD:', styles: { fontStyle: 'bold' } },
        { content: `${regs.vsdSetpoint || 'N/A'}` }
      ],
      [
        { content: 'Vida Filtro Separador:', styles: { fontStyle: 'bold' } },
        { content: `${lives.separatorLife || '0'} hrs` },
        { content: 'Número de Arranques:', styles: { fontStyle: 'bold' } },
        { content: `${regs.startsCount || '0'}` }
      ],
      [
        { content: 'Engrase Motor Principal:', styles: { fontStyle: 'bold' } },
        { content: `${lives.motorGreaseLife || '0'} hrs` },
        { content: 'Retardo de Carga:', styles: { fontStyle: 'bold' } },
        { content: `${regs.loadDelay || '10'} s` }
      ],
      [
        { content: 'TEMPERATURAS Y PRESIONES MEDIDAS EN CARGA', colSpan: 4, styles: { fontStyle: 'bold', fillColor: this.colors.grayBg, halign: 'center' } }
      ],
      [
        { content: 'Temp. Salida Elemento 1:', styles: { fontStyle: 'bold' } },
        { content: `${params.elem1Temp || 'N/M'} °C` },
        { content: 'Presión de Aire:', styles: { fontStyle: 'bold' } },
        { content: `${params.airPressure || 'N/M'} bar` }
      ],
      [
        { content: 'Temp. Elemento 2:', styles: { fontStyle: 'bold' } },
        { content: `${params.elem2Temp || 'N/A'} °C` },
        { content: 'Presión Intermedia:', styles: { fontStyle: 'bold' } },
        { content: `${params.intermediatePressure || 'N/A'} bar` }
      ],
      [
        { content: 'Temperatura del Aceite:', styles: { fontStyle: 'bold' } },
        { content: `${params.oilTemp || 'N/M'} °C`, colSpan: 3 }
      ]
    ];

    doc.autoTable({
      startY: currentY,
      margin: { left: margin, right: margin },
      head: [[{ content: `${sectionIndex++}. PARÁMETROS TÉCNICOS, VIDAS ÚTILES Y REGULACIONES`, colSpan: 4, styles: { fillColor: this.colors.primary, textColor: this.colors.white, fontStyle: 'bold' } }]],
      body: paramsRows,
      theme: 'grid',
      styles: {
        fontSize: 7.2,
        cellPadding: 1.5,
        textColor: this.colors.textDark,
        lineColor: this.colors.grayBorder,
        lineWidth: 0.2
      },
      columnStyles: {
        0: { cellWidth: 46 },
        1: { cellWidth: 47 },
        2: { cellWidth: 46 },
        3: { cellWidth: 47 }
      }
    });

    currentY = doc.lastAutoTable.finalY + 4;

    // --- SECCIÓN 6: OBSERVACIONES Y RECOMENDACIONES ---
    const obsText = report.observations || 'Sin observaciones adicionales registradas.';
    const recText = report.recommendations || 'Mantener monitoreo continuo y limpieza periódica de enfriadores.';

    // Check if new page needed before observations to keep formatting clean
    if (currentY > 235) {
      doc.addPage();
      currentY = margin;
    }

    doc.autoTable({
      startY: currentY,
      margin: { left: margin, right: margin },
      head: [[{ content: `${sectionIndex++}. OBSERVACIONES TÉCNICAS Y RECOMENDACIONES DE INGENIERÍA`, styles: { fillColor: this.colors.primary, textColor: this.colors.white, fontStyle: 'bold' } }]],
      body: [
        [
          {
            content: `OBSERVACIONES DEL SERVICIO:\n${obsText}`,
            styles: { fillColor: this.colors.white }
          }
        ],
        [
          {
            content: `RECOMENDACIONES TÉCNICAS:\n${recText}`,
            styles: { fillColor: this.colors.grayBg }
          }
        ]
      ],
      theme: 'grid',
      styles: {
        fontSize: 7.5,
        cellPadding: 2.2,
        textColor: this.colors.textDark,
        lineColor: this.colors.grayBorder,
        lineWidth: 0.2
      }
    });

    currentY = doc.lastAutoTable.finalY + 6;

    // --- SECCIÓN 7: REGISTRO FOTOGRÁFICO ---
    const photos = report.photos || [];
    if (photos.length > 0) {
      // New page for photographic evidence if space is tight
      if (currentY > 160) {
        doc.addPage();
        currentY = margin;
      }

      // Title bar for Photos
      doc.setFillColor(...this.colors.primary);
      doc.roundedRect(margin, currentY, contentWidth, 7, 1, 1, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...this.colors.white);
      doc.text(`${sectionIndex++}. REGISTRO FOTOGRÁFICO DE ACTIVIDADES EN CAMPO`, margin + 4, currentY + 4.8);
      currentY += 10;

      // 2 photos per row grid: width ~88mm, height ~58mm each
      const photoW = 88;
      const photoH = 55;
      const gutter = 10;

      for (let i = 0; i < photos.length; i += 2) {
        // If row doesn't fit on this page, start new page
        if (currentY + photoH + 16 > pageHeight - margin) {
          doc.addPage();
          currentY = margin + 5;
        }

        const photo1 = photos[i];
        const photo2 = photos[i + 1];

        // Draw Photo 1
        this.renderPhotoCard(doc, photo1, margin, currentY, photoW, photoH, i + 1);

        // Draw Photo 2 if exists
        if (photo2) {
          this.renderPhotoCard(doc, photo2, margin + photoW + gutter, currentY, photoW, photoH, i + 2);
        }

        currentY += photoH + 14;
      }
    }

    // --- SECCIÓN 8: FIRMAS Y CONFORMIDAD ---
    // Check space for signatures card (~60mm needed)
    if (currentY + 62 > pageHeight - margin) {
      doc.addPage();
      currentY = margin;
    } else {
      currentY += 3;
    }

    // Declaración de conformidad
    doc.setFillColor(...this.colors.grayBg);
    doc.roundedRect(margin, currentY, contentWidth, 11, 1, 1, 'F');
    doc.setDrawColor(...this.colors.grayBorder);
    doc.rect(margin, currentY, contentWidth, 11, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(...this.colors.primaryDark);
    doc.text('DECLARACIÓN DE CONFORMIDAD DEL SERVICIO TÉCNICO:', margin + 3, currentY + 4);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...this.colors.textMuted);
    doc.text(
      'Por medio del presente documento, el cliente y el técnico certifican la veracidad de las mediciones registradas y la conformidad con los trabajos efectuados bajo las normativas técnicas de INDUSTRAC S.A.C.',
      margin + 3,
      currentY + 8
    );

    currentY += 13;

    // Cuadros de firma (2 columnas)
    const signW = (contentWidth - 10) / 2;
    const signH = 46;

    // Firma Técnico
    this.renderSignatureBox(
      doc,
      margin,
      currentY,
      signW,
      signH,
      'FIRMA DEL TÉCNICO RESPONSABLE',
      report.techSignature,
      report.techName || report.technician || 'Técnico Especialista',
      'INDUSTRAC S.A.C. - Dpto. Técnico'
    );

    // Firma Cliente
    this.renderSignatureBox(
      doc,
      margin + signW + 10,
      currentY,
      signW,
      signH,
      'CONFORMIDAD DEL CLIENTE',
      report.clientSignature,
      report.clientSignerName || report.client || 'Representante Autorizado',
      report.clientSignerPosition || 'Supervisión / Planta'
    );

    // --- PIE DE PÁGINA EN TODAS LAS PÁGINAS ---
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setDrawColor(...this.colors.grayBorder);
      doc.line(margin, pageHeight - 10, pageWidth - margin, pageHeight - 10);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(...this.colors.textMuted);
      const emissionDate = report.date || (typeof getLocalDateString === 'function' ? getLocalDateString() : new Date().toLocaleDateString('en-CA'));
      const validReportNumber = (report.reportNumber && report.reportNumber !== 'AUTO') ? report.reportNumber : 'REP-2026-0001';
      doc.text(
        `INDUSTRAC S.A.C. | Reporte N° ${validReportNumber} | Emisión: ${emissionDate}`,
        margin,
        pageHeight - 6.5
      );

      doc.text(
        `Página ${p} de ${totalPages}`,
        pageWidth - margin,
        pageHeight - 6.5,
        { align: 'right' }
      );
    }

    return doc;
  }

  // Render individual photo card in PDF
  renderPhotoCard(doc, photo, x, y, w, h, index) {
    doc.setDrawColor(...this.colors.grayBorder);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h + 10, 1.5, 1.5, 'FD');

    // Photo image
    if (photo.dataUrl) {
      try {
        doc.addImage(photo.dataUrl, 'JPEG', x + 1.5, y + 1.5, w - 3, h - 3, undefined, 'FAST');
      } catch (err) {
        console.warn('Error al incrustar foto en PDF:', err);
      }
    }

    // Photo caption bar
    doc.setFillColor(...this.colors.primaryDark);
    doc.rect(x + 1.5, y + h - 1.5, w - 3, 10, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(...this.colors.accent);
    doc.text(`FOTO #${index}:`, x + 3.5, y + h + 4.5);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...this.colors.white);
    const caption = photo.description || 'Evidencia técnica de mantenimiento';
    const splitCaption = doc.splitTextToSize(caption, w - 24);
    doc.text(splitCaption[0] || '', x + 18, y + h + 4.5);
  }

  // Render signature card
  renderSignatureBox(doc, x, y, w, h, title, signatureDataUrl, name, subtitle) {
    doc.setDrawColor(...this.colors.grayBorder);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD');

    // Title banner
    doc.setFillColor(...this.colors.grayBg);
    doc.rect(x, y, w, 6.5, 'F');
    doc.setDrawColor(...this.colors.grayBorder);
    doc.line(x, y + 6.5, x + w, y + 6.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...this.colors.primaryDark);
    doc.text(title, x + w / 2, y + 4.5, { align: 'center' });

    // Signature Canvas Image
    if (signatureDataUrl) {
      try {
        const maxW = w - 16;
        const maxH = 22;
        let drawW = maxW;
        let drawH = maxH;
        if (doc.getImageProperties) {
          try {
            const imgProps = doc.getImageProperties(signatureDataUrl);
            if (imgProps && imgProps.width && imgProps.height) {
              const ratio = imgProps.width / imgProps.height;
              if (ratio > maxW / maxH) {
                drawW = maxW;
                drawH = maxW / ratio;
              } else {
                drawH = maxH;
                drawW = maxH * ratio;
              }
            }
          } catch (propErr) {}
        }
        const drawX = x + (w - drawW) / 2;
        const drawY = y + 8 + (maxH - drawH) / 2;
        doc.addImage(signatureDataUrl, 'PNG', drawX, drawY, drawW, drawH, undefined, 'FAST');
      } catch (e) {
        console.warn('Error incrustando firma:', e);
      }
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7);
      doc.setTextColor(...this.colors.textMuted);
      doc.text('(Sin firma registrada)', x + w / 2, y + 18, { align: 'center' });
    }

    // Separator line for signature line
    doc.setDrawColor(180, 190, 205);
    doc.setLineDashPattern([1, 1], 0);
    doc.line(x + 10, y + 32, x + w - 10, y + 32);
    doc.setLineDashPattern([], 0); // reset dash

    // Name & Subtitle
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...this.colors.textDark);
    doc.text(name, x + w / 2, y + 37, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...this.colors.textMuted);
    doc.text(subtitle, x + w / 2, y + 41.5, { align: 'center' });
  }

  // Cell helper for colored oil level indicator in PDF
  getOilLevelPdfCell(oilLevel = 'Alto') {
    const lvl = (oilLevel || 'Alto').trim();
    let text = 'ALTO (NORMAL)';
    let fillColor = [209, 250, 229]; // light green #D1FAE5
    let textColor = [5, 150, 105];   // green text #059669

    if (lvl.toLowerCase() === 'bajo') {
      text = 'BAJO (CRÍTICO)';
      fillColor = [254, 226, 226];   // light red #FEE2E2
      textColor = [220, 38, 38];     // red text #DC2626
    } else if (lvl.toLowerCase() === 'medio') {
      text = 'MEDIO (ALERTA)';
      fillColor = [254, 243, 199];   // light amber #FEF3C7
      textColor = [217, 119, 6];     // orange text #D97706
    }

    return {
      content: `● ${text}`,
      styles: {
        fontStyle: 'bold',
        fillColor: fillColor,
        textColor: textColor,
        halign: 'center'
      }
    };
  }
}

window.IndustracPdfGenerator = IndustracPdfGenerator;
