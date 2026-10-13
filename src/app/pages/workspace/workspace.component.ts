import { AfterViewInit, Component } from '@angular/core';
import { Router } from '@angular/router';
import jsPDF from 'jspdf';
import { GuidanceService, HistoryEntry, HistorySummary, ServerHistoryPage } from '../../services/guidance.service';
import { RecommendedSignalService } from '../../services/recommended-signal.service';

/** Program tiles that open a dedicated page instead of just selecting an AI guidance program. */
const PROGRAM_TILE_ROUTES: Record<string, string> = {
  'Secure Documents': '/secure-documents',
};

@Component({
  selector: 'app-workspace',
  standalone: true,
  imports: [],
  templateUrl: './workspace.component.html',
  styleUrl: './workspace.component.css',
})
export class WorkspaceComponent implements AfterViewInit {
  constructor(
    private guidance: GuidanceService,
    private recommendedSignals: RecommendedSignalService,
    private router: Router,
  ) {}

  ngAfterViewInit(): void {
    this.init();
    // Retry any responses that couldn't be saved to the API last time (offline / API down).
    void this.guidance.flushPendingSaves();
  }

  private init(): void {
    const tiles = Array.from(document.querySelectorAll<HTMLElement>('.tile'));
    const selectedProgramEl = document.getElementById('selectedProgram');
    const promptEl = document.getElementById('guidancePrompt') as HTMLTextAreaElement | null;
    const form = document.getElementById('guidanceForm') as HTMLFormElement | null;
    const generateBtn = document.getElementById('generateButton') as HTMLButtonElement | null;
    const errorEl = document.getElementById('inlineError');
    const generationStatus = document.getElementById('generationStatus');
    const panel = document.getElementById('recommendationPanel');
    const exportPdfBtn = document.getElementById('exportPdf');
    const copyCurrentBtn = document.getElementById('copyCurrent');
    const regenerateBtn = document.getElementById('regenerateRecommendation') as HTMLButtonElement | null;
    const guidanceModal = document.getElementById('guidanceModal') as HTMLDialogElement | null;
    const closeGuidanceModal = document.getElementById('closeGuidanceModal') as HTMLButtonElement | null;
    const historyButton = document.getElementById('historyButton');
    const historyPanel = document.getElementById('historyPanel');
    const historyList = document.getElementById('historyList');
    const closeHistory = document.getElementById('closeHistory');
    const clearHistoryBtn = document.getElementById('clearHistory');
    const overlay = document.getElementById('overlay');
    const search = document.getElementById('historySearch') as HTMLInputElement | null;
    const clearSearch = document.getElementById('clearHistorySearch');
    const signalSuggestions = document.getElementById('signalSuggestions');
    const signalList = document.getElementById('signalList');

    if (
      !selectedProgramEl || !promptEl || !form || !generateBtn || !errorEl || !generationStatus || !panel ||
      !exportPdfBtn || !copyCurrentBtn || !regenerateBtn || !guidanceModal || !closeGuidanceModal ||
      !historyButton || !historyPanel || !historyList ||
      !closeHistory || !clearHistoryBtn || !overlay || !search || !clearSearch
    ) {
      return;
    }

    const openGuidanceModal = () => {
      if (!guidanceModal.open) guidanceModal.showModal();
    };

    closeGuidanceModal.addEventListener('click', () => guidanceModal.close());

    let program = 'Health & Wellness';
    let lastFocused: HTMLElement | null = null;
    let currentEntry: HistoryEntry | null = null;
    let signalRequest = 0;

    /** Data-driven "Try a signal" row: recommended prompts for the selected guidance category. */
    const renderSignals = async (forProgram: string) => {
      if (!signalSuggestions || !signalList) return;
      const request = ++signalRequest;
      signalSuggestions.setAttribute('aria-busy', 'true');
      const signals = await this.recommendedSignals.forCategory(forProgram);
      if (request !== signalRequest) return; // a newer tile selection won the race
      signalList.replaceChildren(
        ...signals.map(text => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'signal-enter';
          button.dataset['suggestion'] = text;
          button.textContent = text;
          return button;
        }),
      );
      signalSuggestions.classList.toggle('empty', signals.length === 0);
      signalSuggestions.removeAttribute('aria-busy');
    };

    const showGuidance = (item: HistoryEntry) => {
      currentEntry = item;
      document.getElementById('recommendationPriority')!.textContent = item.guidance.priority;
      document.getElementById('recommendationStep')!.textContent = item.guidance.firstStep;
      document.getElementById('recommendationCompliance')!.textContent = item.guidance.compliance;
      document.getElementById('recommendationNote')!.textContent = item.guidance.note;
      const modulesEl = document.getElementById('recommendationModules')!;
      modulesEl.replaceChildren();
      item.guidance.modules.forEach(module => {
        const li = document.createElement('li');
        li.textContent = module;
        modulesEl.append(li);
      });
      generationStatus.classList.add('hidden');
      panel.classList.remove('hidden');
      openGuidanceModal();
    };

    const selectProgram = (nextProgram: string) => {
      program = nextProgram;
      selectedProgramEl.textContent = nextProgram;
      tiles.forEach(tile => {
        const active = tile.dataset['program'] === nextProgram;
        tile.classList.toggle('selected', active);
        tile.setAttribute('aria-pressed', String(active));
      });
      void renderSignals(nextProgram);
    };

    const copyEntry = async (entry: HistoryEntry, control: HTMLElement) => {
      try {
        const text = this.guidance.recommendationText(entry);
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.append(textarea);
          textarea.select();
          const copied = document.execCommand('copy');
          textarea.remove();
          if (!copied) throw new Error('Clipboard access was unavailable.');
        }
        const original = control.innerHTML;
        control.textContent = '✓';
        control.setAttribute('aria-label', 'Recommendation copied');
        setTimeout(() => {
          control.innerHTML = original;
          control.setAttribute('aria-label', 'Copy recommendation');
        }, 1200);
      } catch {
        errorEl.textContent = 'Clipboard access was unavailable. Please select and copy the guidance manually.';
        errorEl.classList.remove('hidden');
      }
    };

    const historySourceLabel = document.getElementById('historySourceLabel');
    let historyRequest = 0;

    const showHistoryMessage = (title: string, detail: string, icon = '↶') => {
      const box = document.createElement('div');
      box.className = 'history-empty';
      const iconEl = document.createElement('span');
      iconEl.className = 'history-empty-icon';
      iconEl.textContent = icon;
      const strong = document.createElement('strong');
      strong.textContent = title;
      const span = document.createElement('span');
      span.textContent = detail;
      box.append(iconEl, strong, span);
      historyList.replaceChildren(box);
    };

    /** One history row. All text is set with textContent (stored data is untrusted). */
    const buildHistoryRecord = (row: {
      program: string;
      priority: string;
      prompt: string;
      createdAt: string;
      owner?: string;
      onOpen: () => void;
      onCopy: (control: HTMLElement) => void;
      onDelete?: (control: HTMLButtonElement) => void;
    }) => {
      const record = document.createElement('div');
      record.className = 'history-record';
      const item = document.createElement('button');
      item.className = 'history-item';
      item.type = 'button';
      const top = document.createElement('span');
      top.className = 'history-item-top';
      const industry = document.createElement('span');
      industry.textContent = row.owner ? `${row.program} · ${row.owner}` : row.program;
      const time = document.createElement('time');
      const date = new Date(row.createdAt);
      if (!Number.isNaN(date.getTime())) {
        time.dateTime = date.toISOString();
        time.textContent = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      }
      top.append(industry, time);
      const title = document.createElement('strong');
      title.textContent = row.priority;
      const excerpt = document.createElement('span');
      excerpt.className = 'history-prompt';
      excerpt.textContent = row.prompt;
      const open = document.createElement('span');
      open.className = 'history-open';
      open.textContent = 'Open guidance ›';
      item.append(top, title, excerpt, open);
      item.addEventListener('click', row.onOpen);
      const copy = document.createElement('button');
      copy.className = 'history-copy';
      copy.type = 'button';
      copy.title = 'Copy recommendation';
      copy.setAttribute('aria-label', 'Copy recommendation');
      copy.textContent = '⧉';
      copy.addEventListener('click', () => row.onCopy(copy));
      record.append(item, copy);
      if (row.onDelete) {
        record.classList.add('has-delete');
        const remove = document.createElement('button');
        remove.className = 'history-copy history-delete';
        remove.type = 'button';
        remove.title = 'Delete recommendation';
        remove.setAttribute('aria-label', 'Delete recommendation');
        remove.textContent = '×';
        remove.addEventListener('click', () => row.onDelete!(remove));
        record.append(remove);
      }
      return record;
    };

    const openEntry = (entry: HistoryEntry) => {
      selectProgram(entry.program);
      promptEl.value = entry.prompt;
      setHistory(false);
      showGuidance(entry);
    };

    /** Signed in: history comes from the database (GET api/GuidanceResponse), scoped by role. */
    const renderServerHistory = async (request: number) => {
      clearHistoryBtn.classList.add('hidden');
      if (historySourceLabel) historySourceLabel.textContent = 'Saved to your account';
      let page: ServerHistoryPage;
      try {
        page = await this.guidance.loadServerHistory();
      } catch (reason) {
        if (request !== historyRequest) return;
        showHistoryMessage("Couldn't load saved guidance", reason instanceof Error ? reason.message : 'Please try again.', '!');
        return;
      }
      if (request !== historyRequest) return;

      if (historySourceLabel) {
        historySourceLabel.textContent =
          page.scope === 'All' ? 'All companies (admin view)' : page.scope === 'Company' ? "Your company's saved guidance" : 'Saved to your account';
      }
      if (!page.items.length) {
        showHistoryMessage('No saved recommendations yet', 'Guidance you generate while signed in is saved to your account.');
        return;
      }

      const loadFull = async (summary: HistorySummary): Promise<HistoryEntry | null> => {
        try {
          return await this.guidance.loadServerEntry(summary.id);
        } catch (reason) {
          errorEl.textContent = reason instanceof Error ? reason.message : "We couldn't open that recommendation.";
          errorEl.classList.remove('hidden');
          setHistory(false);
          return null;
        }
      };

      historyList.replaceChildren(
        ...page.items.map(summary =>
          buildHistoryRecord({
            program: summary.program,
            priority: summary.priority,
            prompt: summary.prompt,
            createdAt: summary.createdAt,
            // Admin views span several users: show whose guidance it is.
            owner:
              page.scope !== 'Own' && (summary.createdByEmail || summary.createdByUserId)
                ? summary.createdByEmail || `User ${summary.createdByUserId}`
                : undefined,
            onOpen: () => void loadFull(summary).then(entry => entry && openEntry(entry)),
            onCopy: control => void loadFull(summary).then(entry => entry && copyEntry(entry, control)),
            onDelete: summary.canDelete
              ? control => {
                  if (!window.confirm('Delete this saved recommendation for everyone who can see it? This cannot be undone.')) return;
                  control.disabled = true;
                  this.guidance
                    .deleteServerEntry(summary.id)
                    .then(() => {
                      if (currentEntry?.id === summary.id) currentEntry = null;
                      void renderHistory();
                    })
                    .catch(reason => {
                      control.disabled = false;
                      errorEl.textContent = reason instanceof Error ? reason.message : "We couldn't delete that recommendation.";
                      errorEl.classList.remove('hidden');
                    });
                }
              : undefined,
          }),
        ),
      );
    };

    /** Signed out: history stays on this device (localStorage), as before. */
    const renderDeviceHistory = () => {
      clearHistoryBtn.classList.remove('hidden');
      if (historySourceLabel) historySourceLabel.textContent = 'Stored on this device';
      const entries = this.guidance.readHistory();
      if (!entries.length) {
        showHistoryMessage('No saved recommendations yet', 'Your generated guidance will appear here for quick access. Sign in to save it to your account.');
        return;
      }
      historyList.replaceChildren(
        ...entries.map(entry =>
          buildHistoryRecord({
            program: entry.program,
            priority: entry.guidance.priority,
            prompt: entry.prompt,
            createdAt: entry.createdAt,
            onOpen: () => openEntry(entry),
            onCopy: control => void copyEntry(entry, control),
          }),
        ),
      );
    };

    const renderHistory = async () => {
      const request = ++historyRequest;
      showHistoryMessage('Loading saved guidance…', '', '↻');
      if (this.guidance.usesServerHistory) {
        await renderServerHistory(request);
      } else {
        renderDeviceHistory();
      }
    };

    const setHistory = (open: boolean) => {
      historyPanel.classList.toggle('show', open);
      overlay.classList.toggle('show', open);
      historyPanel.setAttribute('aria-hidden', String(!open));
      historyButton.setAttribute('aria-expanded', String(open));
      if (open) {
        lastFocused = document.activeElement as HTMLElement | null;
        void renderHistory();
        closeHistory.focus();
      } else if (lastFocused) {
        lastFocused.focus();
      }
    };

    tiles.forEach(tile => tile.addEventListener('click', () => {
      const nextProgram = tile.dataset['program'] || program;
      const route = PROGRAM_TILE_ROUTES[nextProgram];
      if (route) {
        this.router.navigateByUrl(route);
        return;
      }
      selectProgram(nextProgram);
    }));
    // Signals are rendered from the API, so delegate clicks from the container.
    signalList?.addEventListener('click', event => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-suggestion]');
      if (!button) return;
      promptEl.value = button.dataset['suggestion'] || '';
      promptEl.focus();
    });

    const setGenerating = (isGenerating: boolean) => {
      generateBtn.disabled = isGenerating;
      regenerateBtn.disabled = isGenerating;
      generationStatus.classList.toggle('hidden', !isGenerating);
      generateBtn.innerHTML = isGenerating
        ? '<span class="inline-spinner" aria-hidden="true"></span><span>Generating guidance</span>'
        : '<span>Generate guidance</span><span aria-hidden="true">↗</span>';
      regenerateBtn.innerHTML = isGenerating
        ? '<span class="inline-spinner" aria-hidden="true"></span><span>Regenerating</span>'
        : '↻ Regenerate';
    };

    const exportCurrentPdf = () => {
      if (!currentEntry) {
        errorEl.textContent = 'PDF export is temporarily unavailable.';
        errorEl.classList.remove('hidden');
        return;
      }
      const entry = currentEntry;
      const doc = new jsPDF({ format: 'letter', unit: 'pt' });
      const margin = 44;
      const width = doc.internal.pageSize.getWidth() - margin * 2;
      let y = 54;
      const add = (text: string, size = 10, bold = false, gap = 8) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(size);
        const lines = doc.splitTextToSize(text, width);
        const lineHeight = size * 1.45;
        if (y + lines.length * lineHeight > 740) {
          doc.addPage();
          y = 48;
        }
        doc.text(lines, margin, y);
        y += lines.length * lineHeight + gap;
      };
      doc.setFillColor(7, 12, 20);
      doc.rect(0, 0, 612, 83, 'F');
      doc.setTextColor(231, 183, 79);
      add('LISTENPAY GUIDANCE AI', 10, true, 10);
      doc.setTextColor(244, 247, 248);
      add('Workforce recommendation', 20, true, 22);
      doc.setTextColor(20, 31, 42);
      add(`PROGRAM / ${entry.program.toUpperCase()}`, 9, true, 15);
      add('Recommended focus', 10, true, 4);
      add(entry.guidance.priority, 15, true, 16);
      add('Request context', 10, true, 4);
      add(entry.prompt, 10, false, 14);
      add('Start here', 10, true, 4);
      add(entry.guidance.firstStep, 10, false, 14);
      add('Training modules', 10, true, 4);
      entry.guidance.modules.forEach(module => add(`• ${module}`, 10, false, 2));
      y += 12;
      add('Compliance lens', 10, true, 4);
      add(entry.guidance.compliance, 10, false, 14);
      doc.setTextColor(92, 106, 119);
      add(entry.guidance.note, 9, false, 0);
      doc.save(`listenpay-${entry.program.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-guidance.pdf`);
    };

    const clearStoredHistory = () => {
      if (!this.guidance.readHistory().length) return;
      if (!window.confirm('Clear all saved ListenPay recommendations from this device? This cannot be undone.')) return;
      this.guidance.clearHistory();
      currentEntry = null;
      void renderHistory();
    };

    historyButton.addEventListener('click', () => setHistory(true));
    closeHistory.addEventListener('click', () => setHistory(false));
    clearHistoryBtn.addEventListener('click', clearStoredHistory);
    overlay.addEventListener('click', () => setHistory(false));
    exportPdfBtn.addEventListener('click', exportCurrentPdf);
    copyCurrentBtn.addEventListener('click', () => {
      if (currentEntry) void copyEntry(currentEntry, copyCurrentBtn);
    });
    regenerateBtn.addEventListener('click', () => form.requestSubmit());
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && historyPanel.classList.contains('show')) setHistory(false);
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const value = promptEl.value.trim();
      if (value.length < 12) {
        errorEl.textContent = 'Add a little more context so the recommendation can be useful.';
        errorEl.classList.remove('hidden');
        promptEl.focus();
        return;
      }
      errorEl.classList.add('hidden');
      panel.classList.add('hidden');
      setGenerating(true);
      openGuidanceModal();
      streamNextResponse = true;
      try {
        const generatedGuidance = await this.guidance.generate(program, value);
        const entry: HistoryEntry = {
          id: this.guidance.newId(), // GUID: also the GuidanceResponseId stored by the API
          program,
          prompt: value,
          guidance: generatedGuidance,
          createdAt: new Date().toISOString(),
        };
        // Signed in: the database is the history (saved below). Signed out: keep it on this device.
        if (!this.guidance.usesServerHistory) this.guidance.addToHistory(entry);
        // Store in dbo.GuidanceResponse / GuidanceResponseModule. Fire-and-forget: a failed
        // save is queued and retried, and never blocks showing the recommendation.
        void this.guidance.saveResponse(entry);
        showGuidance(entry);
      } catch (reason) {
        guidanceModal.close();
        errorEl.textContent = reason instanceof Error ? reason.message : "We couldn't generate that recommendation.";
        errorEl.classList.remove('hidden');
      } finally {
        setGenerating(false);
      }
    });

    // --- History search ---
    const filterHistory = () => {
      const query = search.value.trim().toLocaleLowerCase();
      let matches = 0;
      historyList.querySelectorAll<HTMLElement>('.history-record').forEach(record => {
        const matchesQuery = !query || (record.textContent || '').toLocaleLowerCase().includes(query);
        (record as HTMLElement).hidden = !matchesQuery;
        if (matchesQuery) matches += 1;
      });
      let empty = document.getElementById('historySearchEmpty');
      if (query && matches === 0 && historyList.querySelector('.history-record')) {
        if (!empty) {
          empty = document.createElement('div');
          empty.id = 'historySearchEmpty';
          empty.className = 'history-empty';
          empty.innerHTML = '<strong>No matching recommendations</strong><span>Try a program name, request detail, or guidance phrase.</span>';
          historyList.append(empty);
        }
      } else if (empty) {
        empty.remove();
      }
      clearSearch.classList.toggle('hidden', !search.value);
    };

    search.addEventListener('input', filterHistory);
    clearSearch.addEventListener('click', () => {
      search.value = '';
      filterHistory();
      search.focus();
    });
    new MutationObserver(filterHistory).observe(historyList, { childList: true, subtree: true });

    // --- Streamed reveal of a freshly generated recommendation ---
    let streamNextResponse = false;
    let streaming = false;
    const responseFields = [
      'recommendationPriority',
      'recommendationStep',
      'recommendationModules',
      'recommendationCompliance',
      'recommendationNote',
    ];

    const streamResponse = () => {
      if (!streamNextResponse || streaming || panel.classList.contains('hidden')) return;
      streamNextResponse = false;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const targets = responseFields.map(id => document.getElementById(id)!);
      const contents = targets.map(target =>
        target.id === 'recommendationModules'
          ? Array.from(target.querySelectorAll('li')).map(item => item.textContent || '')
          : target.textContent || '',
      );
      if (!contents.some(content => (Array.isArray(content) ? content.length : content))) return;
      streaming = true;
      panel.setAttribute('aria-busy', 'true');
      panel.classList.add('response-streaming');
      targets.forEach(target => target.replaceChildren());
      let field = 0;
      let index = 0;
      const tick = () => {
        const target = targets[field];
        const text = contents[field];
        if (!target) {
          panel.removeAttribute('aria-busy');
          panel.classList.remove('response-streaming');
          streaming = false;
          return;
        }
        if (Array.isArray(text)) {
          if (index < text.length) {
            const item = document.createElement('li');
            item.textContent = text[index];
            target.append(item);
            index += 1;
            setTimeout(tick, 95);
            return;
          }
        } else {
          index = Math.min(text.length, index + 8);
          target.textContent = text.slice(0, index);
          if (index < text.length) {
            setTimeout(tick, 18);
            return;
          }
        }
        field += 1;
        index = 0;
        setTimeout(tick, 70);
      };
      tick();
    };
    new MutationObserver(() => setTimeout(streamResponse, 0)).observe(panel, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Initial state
    selectProgram(program);
  }
}
