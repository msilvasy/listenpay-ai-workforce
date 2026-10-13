import { AfterViewInit, Component } from '@angular/core';
import { Router } from '@angular/router';
import jsPDF from 'jspdf';

interface SecureDocument {
  id: string;
  title: string;
  description: string;
  fileUrl: string;
  fileName: string;
}

interface SignatureRecord {
  documentId: string;
  signerName: string;
  signatureDataUrl: string | null;
  signedAt: string;
}

type SignatureMode = 'draw' | 'type';

const SIGNATURE_STORAGE_KEY = 'listenpay-secure-documents-signatures';
const TYPED_SIGNATURE_FONT = "56px 'Brush Script MT', 'Segoe Script', cursive";

/** Generic PDF document icon (red file glyph with a folded corner), used for each listed document. */
const PDF_FILE_ICON_SVG = `
  <svg viewBox="0 0 40 48" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
    <path d="M6 2h18l10 10v32a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#E2402E"/>
    <path d="M24 2v8a2 2 0 0 0 2 2h8L24 2z" fill="#9E2A1F"/>
    <text x="20" y="33" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="10.5"
      font-weight="700" fill="#ffffff" letter-spacing=".5">PDF</text>
  </svg>
`;

@Component({
  selector: 'app-secure-documents',
  standalone: true,
  imports: [],
  templateUrl: './secure-documents.component.html',
  styleUrl: './secure-documents.component.css',
})
export class SecureDocumentsComponent implements AfterViewInit {
  constructor(private router: Router) {}

  /** Demo document set. In production this would come from a documents service/API. */
  private readonly documents: SecureDocument[] = [
    {
      id: 'workforce-program-agreement',
      title: 'Workforce Program Agreement',
      description: 'Confirms enrollment in the selected workforce training and compliance program.',
      fileUrl: '/documents/secure-agreement-demo.pdf',
      fileName: 'secure-agreement-demo.pdf',
    },
  ];

  ngAfterViewInit(): void {
    this.init();
  }

  private readSignatures(): Record<string, SignatureRecord> {
    try {
      const raw = sessionStorage.getItem(SIGNATURE_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, SignatureRecord>) : {};
    } catch {
      return {};
    }
  }

  private saveSignature(record: SignatureRecord): void {
    const all = this.readSignatures();
    all[record.documentId] = record;
    sessionStorage.setItem(SIGNATURE_STORAGE_KEY, JSON.stringify(all));
  }

  private init(): void {
    const list = document.getElementById('documentList');
    const emptyState = document.getElementById('signingEmptyState');
    const signingPanel = document.getElementById('signingPanel');
    const docTitle = document.getElementById('signingDocTitle');
    const docDescription = document.getElementById('signingDocDescription');
    const frame = document.getElementById('documentFrame') as HTMLIFrameElement | null;
    const downloadLink = document.getElementById('downloadOriginal') as HTMLAnchorElement | null;
    const nameInput = document.getElementById('typedSignatureName') as HTMLInputElement | null;
    const useDrawTab = document.getElementById('useDrawTab') as HTMLButtonElement | null;
    const useTypeTab = document.getElementById('useTypeTab') as HTMLButtonElement | null;
    const drawPanel = document.getElementById('drawSignaturePanel');
    const typePanel = document.getElementById('typeSignaturePanel');
    const typedPreview = document.getElementById('typedSignaturePreview');
    const canvas = document.getElementById('signaturePad') as HTMLCanvasElement | null;
    const clearSignatureBtn = document.getElementById('clearSignature') as HTMLButtonElement | null;
    const agreeCheckbox = document.getElementById('signatureAgreement') as HTMLInputElement | null;
    const signButton = document.getElementById('signDocumentButton') as HTMLButtonElement | null;
    const signStatus = document.getElementById('signStatus');
    const signedBanner = document.getElementById('signedBanner');
    const signedMeta = document.getElementById('signedMeta');
    const certificateBtn = document.getElementById('downloadCertificate') as HTMLButtonElement | null;
    const backButton = document.getElementById('backToWorkspace');

    if (
      !list || !emptyState || !signingPanel || !docTitle || !docDescription || !frame || !downloadLink ||
      !nameInput || !useDrawTab || !useTypeTab || !drawPanel || !typePanel || !typedPreview || !canvas ||
      !clearSignatureBtn || !agreeCheckbox || !signButton || !signStatus || !signedBanner || !signedMeta ||
      !certificateBtn || !backButton
    ) {
      return;
    }

    backButton.addEventListener('click', () => this.router.navigateByUrl('/workspace'));

    const ctx = canvas.getContext('2d');
    let drawing = false;
    let hasDrawnStroke = false;
    let signatureMode: SignatureMode = 'draw';
    let activeDocument: SecureDocument | null = null;

    const configureCanvas = () => {
      if (!ctx) return;
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(rect.width, 1) * ratio;
      canvas.height = Math.max(rect.height, 1) * ratio;
      ctx.scale(ratio, ratio);
      ctx.strokeStyle = '#eef2f6';
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    };

    const clearCanvas = () => {
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasDrawnStroke = false;
      updateSignButtonState();
    };

    const pointFromEvent = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    canvas.addEventListener('pointerdown', event => {
      drawing = true;
      const { x, y } = pointFromEvent(event);
      ctx?.beginPath();
      ctx?.moveTo(x, y);
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener('pointermove', event => {
      if (!drawing) return;
      const { x, y } = pointFromEvent(event);
      ctx?.lineTo(x, y);
      ctx?.stroke();
      hasDrawnStroke = true;
      updateSignButtonState();
    });

    const endStroke = () => {
      drawing = false;
    };
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointerleave', endStroke);
    clearSignatureBtn.addEventListener('click', clearCanvas);

    const updateTypedPreview = () => {
      typedPreview.textContent = nameInput.value.trim() || 'Your signature';
    };

    const updateSignButtonState = () => {
      const hasName = nameInput.value.trim().length > 1;
      const hasSignature = signatureMode === 'draw' ? hasDrawnStroke : hasName;
      signButton.disabled = !hasSignature || !hasName || !agreeCheckbox.checked;
    };

    const setSignatureMode = (mode: SignatureMode) => {
      signatureMode = mode;
      useDrawTab.classList.toggle('is-active', mode === 'draw');
      useDrawTab.setAttribute('aria-selected', String(mode === 'draw'));
      useTypeTab.classList.toggle('is-active', mode === 'type');
      useTypeTab.setAttribute('aria-selected', String(mode === 'type'));
      drawPanel.hidden = mode !== 'draw';
      typePanel.hidden = mode !== 'type';
      updateSignButtonState();
    };

    useDrawTab.addEventListener('click', () => setSignatureMode('draw'));
    useTypeTab.addEventListener('click', () => setSignatureMode('type'));
    nameInput.addEventListener('input', () => {
      updateTypedPreview();
      updateSignButtonState();
    });
    agreeCheckbox.addEventListener('change', updateSignButtonState);

    const renderTypedSignature = (name: string): string => {
      const typedCanvas = document.createElement('canvas');
      typedCanvas.width = 600;
      typedCanvas.height = 160;
      const typedCtx = typedCanvas.getContext('2d');
      if (typedCtx) {
        typedCtx.fillStyle = '#0b0f16';
        typedCtx.fillRect(0, 0, typedCanvas.width, typedCanvas.height);
        typedCtx.fillStyle = '#eef2f6';
        typedCtx.font = TYPED_SIGNATURE_FONT;
        typedCtx.textBaseline = 'middle';
        typedCtx.fillText(name, 24, typedCanvas.height / 2);
      }
      return typedCanvas.toDataURL('image/png');
    };

    const showSignedState = (record: SignatureRecord) => {
      signedBanner.hidden = false;
      signButton.hidden = true;
      signStatus.textContent = '';
      const when = new Date(record.signedAt);
      signedMeta.textContent = `Signed by ${record.signerName} on ${when.toLocaleString()}`;
    };

    const renderDocumentList = () => {
      const signatures = this.readSignatures();
      list.replaceChildren();
      this.documents.forEach(doc => {
        const signed = Boolean(signatures[doc.id]);
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'document-item' + (activeDocument?.id === doc.id ? ' is-active' : '');

        const icon = document.createElement('span');
        icon.className = 'document-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = PDF_FILE_ICON_SVG;

        const info = document.createElement('span');
        info.className = 'document-info';

        const title = document.createElement('span');
        title.className = 'document-title';
        title.textContent = doc.title;

        const status = document.createElement('span');
        status.className = 'document-status ' + (signed ? 'is-signed' : 'is-pending');
        status.textContent = signed ? 'Signed' : 'Pending signature';

        info.append(title, status);
        item.append(icon, info);
        item.addEventListener('click', () => openDocument(doc));
        list.append(item);
      });
    };

    const openDocument = (doc: SecureDocument) => {
      activeDocument = doc;
      const existing = this.readSignatures()[doc.id];

      emptyState.hidden = true;
      signingPanel.hidden = false;
      docTitle.textContent = doc.title;
      docDescription.textContent = doc.description;
      frame.src = doc.fileUrl;
      downloadLink.href = doc.fileUrl;
      downloadLink.setAttribute('download', doc.fileName);

      nameInput.value = existing?.signerName && existing.signerName !== 'Authorized signer' ? existing.signerName : '';
      updateTypedPreview();
      clearCanvas();
      agreeCheckbox.checked = false;
      setSignatureMode('draw');
      signStatus.textContent = '';
      signButton.hidden = false;
      signButton.disabled = true;
      signedBanner.hidden = !existing;

      if (existing) showSignedState(existing);

      renderDocumentList();
      window.setTimeout(configureCanvas, 0);
    };

    signButton.addEventListener('click', () => {
      if (!activeDocument) return;
      const signerName = nameInput.value.trim();
      if (!signerName) return;

      const signatureDataUrl = signatureMode === 'draw' ? canvas.toDataURL('image/png') : renderTypedSignature(signerName);

      const record: SignatureRecord = {
        documentId: activeDocument.id,
        signerName,
        signatureDataUrl,
        signedAt: new Date().toISOString(),
      };

      this.saveSignature(record);
      signStatus.textContent = 'Signature captured and recorded for this session.';
      showSignedState(record);
      renderDocumentList();
    });

    certificateBtn.addEventListener('click', () => {
      if (!activeDocument) return;
      const record = this.readSignatures()[activeDocument.id];
      if (!record) return;
      this.downloadCertificate(activeDocument, record);
    });

    window.addEventListener('resize', () => {
      if (!signingPanel.hidden) configureCanvas();
    });

    configureCanvas();
    renderDocumentList();
  }

  private downloadCertificate(doc: SecureDocument, record: SignatureRecord): void {
    const pdf = new jsPDF({ format: 'letter', unit: 'pt' });
    const marginX = 56;
    let y = 76;

    pdf.setFillColor(7, 12, 20);
    pdf.rect(0, 0, 612, 78, 'F');
    pdf.setTextColor(231, 183, 79);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.text('LISTENPAY SECURE DOCUMENTS', marginX, 34);
    pdf.setTextColor(244, 247, 248);
    pdf.setFontSize(18);
    pdf.text('Electronic Signature Certificate', marginX, 58);

    pdf.setTextColor(20, 31, 42);
    y = 112;

    const rows: Array<[string, string]> = [
      ['Document', doc.title],
      ['Signer', record.signerName],
      ['Signed at', new Date(record.signedAt).toLocaleString()],
      ['Status', 'Signed'],
    ];
    pdf.setFontSize(11);
    rows.forEach(([label, value]) => {
      pdf.setFont('helvetica', 'bold');
      pdf.text(`${label}:`, marginX, y);
      pdf.setFont('helvetica', 'normal');
      pdf.text(value, marginX + 100, y);
      y += 22;
    });

    y += 14;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text('Captured signature', marginX, y);
    y += 12;

    if (record.signatureDataUrl) {
      pdf.addImage(record.signatureDataUrl, 'PNG', marginX, y, 220, 58);
    }

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(140, 140, 140);
    pdf.text(
      'Demo certificate only. Connect this workflow to a certified e-signature provider before production use.',
      marginX,
      740,
    );

    pdf.save(`${doc.fileName.replace(/\.pdf$/i, '')}-signature-certificate.pdf`);
  }
}
