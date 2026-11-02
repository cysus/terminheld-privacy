// ==UserScript==
// @name         TERMINHELD Privacy V23.2
// @namespace    https://github.com/cysus/terminheld-privacy
// @version      23.2.0
// @description  Ersetzt Patientennamen durch Pseudonyme und maskiert Telefonnummern, Adressen und E-Mail-Adressen, bevor KI-Assistenten die Seite lesen. Eingabefelder bleiben unangetastet. RDP-Optimiert.
// @match        https://mein.terminheld.de/*
// @updateURL    https://raw.githubusercontent.com/cysus/terminheld-privacy/main/terminheld-privacy.user.js
// @downloadURL  https://raw.githubusercontent.com/cysus/terminheld-privacy/main/terminheld-privacy.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    let isAnonymized = true;
    let observer = null;

    // --- 1. CSS (Touch & Wackel-Effekt) ---
    const styleSheet = document.createElement("style");
    styleSheet.textContent = `
        @keyframes th-nervous-wiggle {
            0% { transform: rotate(0deg); }
            20% { transform: rotate(-2deg); }
            40% { transform: rotate(2deg); }
            60% { transform: rotate(-1deg); }
            80% { transform: rotate(1deg); }
            100% { transform: rotate(0deg); }
        }
        .th-alert-mode {
            animation: th-nervous-wiggle 0.6s ease-in-out infinite;
            box-shadow: 0 0 20px rgba(244, 67, 54, 0.9) !important;
            border: 3px solid #ffeba0 !important;
        }
    `;
    (document.head || document.documentElement).appendChild(styleSheet);

    // --- 2. LISTEN ---
    // Wörter, die nie als Name gelernt oder maskiert werden.
    // Bewusst NICHT enthalten: Wörter, die auch Nachnamen sind (Vater, Kind, Bruder, Laut, Stand, Ton, Klang, Wort, Ziel).
    const ignoreWords = [
        // Struktur
        'familie', 'fam', 'herr', 'herrn', 'hr', 'frau', 'fr', 'dr', 'prof', 'med', 'dipl', 'von', 'und', 'oder',
        'person', 'name',
        'der', 'die', 'das', 'dem', 'den', 'zu', 'im', 'in', 'am', 'mit', 'auf',
        // Kontakt & UI
        'tel', 'mobil', 'fax', 'mail', 'email', 'straße', 'str', 'nr',
        'privat', 'geschäftlich', 'termin', 'termine', 'datum', 'uhrzeit', 'uhr', 'patient', 'patientin',
        'behandlung', 'diagnose', 'rezept', 'alter', 'geb',
        'kalender', 'lupe', 'kontakte', 'kontakt', 'suche', 'einstellungen', 'hilfe',
        'dashboard', 'startseite', 'logout', 'abmelden', 'anmelden', 'profil',
        'menü', 'navigation', 'ansicht', 'tag', 'woche', 'monat', 'liste', 'foto', 'vom',
        'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag',
        // Termintitel (sonst als "Name" gelernt)
        'erstgespräch', 'gespräch', 'elterngespräch', 'hausbesuch', 'absage', 'abgesagt', 'ausfall',
        'pause', 'mittagspause', 'urlaub', 'krank', 'frei', 'blocker', 'besprechung', 'teambesprechung',
        'team', 'meeting', 'fortbildung', 'verwaltung', 'dokumentation', 'vertretung', 'folgetermin',
        'einzeltherapie', 'gruppentherapie', 'gruppe', 'einzel', 'praxis', 'neu', 'neupatient', 'neupatientin',
        'reserviert', 'offen', 'min', 'minuten', 'std', 'ergo', 'logo', 'physio',
        // Verben & Füllwörter
        'sehr', 'geehrte', 'geehrter', 'hallo', 'guten', 'heute', 'gestern', 'morgen',
        'startet', 'zeigt', 'sich', 'nicht', 'aber', 'auch', 'dass', 'wenn', 'dann',
        'weil', 'war', 'ist', 'hat', 'wurde', 'wird', 'kann', 'soll', 'muss',
        // Medizinisch / Therapie
        'therapie', 'bericht', 'befund', 'logopädie', 'ergotherapie', 'physiotherapie',
        'sprache', 'sprechen', 'leise', 'stimme',
        'entwicklung', 'maßnahme', 'wortschatz', 'wörter',
        'motorik', 'grobmotorik', 'feinmotorik', 'wahrnehmung', 'konzentration',
        'eltern', 'mutter', 'schwester'
    ];

    // Stellen, an denen Terminheld Patientennamen anzeigt. Nur hier werden Namen gelernt.
    const sourceSelectors = [
        '.ListItem-content-title',
        '#MagnifierObjectCard .generic',
        '.ContactFileTab h2',
        '.fc-event-title',
        '.t-card-title'
    ];
    const SOURCE_SELECTOR = sourceSelectors.join(',');
    // Hauptmenü nutzt dieselbe Klasse wie die Patientenliste; Menüpunkte sind keine Namen
    const SOURCE_EXCLUDE = '.MainNavigation';

    // Kalender (DayPilot): Termine heißen "11:30 Nachname, Vorname – Leistung".
    // Nur "Nachname, Vorname" wird gelernt, Termine wie "Orga" oder "TEAM" nicht.
    const CALENDAR_SELECTOR = '#dpCalendar';
    const CALENDAR_NAME = /(?<![\p{L}\p{M}'’])\p{Lu}[\p{L}\p{M}'’\-]*(?:\s+\p{Lu}[\p{L}\p{M}'’\-]*)*,\s*\p{Lu}[\p{L}\p{M}'’\-]*(?:\s+\p{Lu}[\p{L}\p{M}'’\-]*)*/gu;

    // Bereiche mit ausschließlich persönlichen Daten, Inhalt wird komplett maskiert:
    // Kopf der Lupe (Name, Geburtsdatum, Telefon), Kopf der Akte (Name, Geburtsdatum) und die Stammdaten-Felder
    // (Telefon, E-Mail, Adresse, Versichertenkarte, Briefanrede, wichtige Doku-Einträge)
    const FULL_MASK_SELECTOR = '.MagnifierObjectCard .ListItem-content, .ContactFileTab h2, .MagnifierFieldset-content';

    // Kontaktdaten außerhalb der Kontaktfelder (Notizen, Termintitel, Tooltips)
    const PHONE = /(?:\+|\b0)\d[\d \/\-()]{4,}\d/g;
    const STREET = /(?<!\p{L})(?:\p{Lu}[\p{L}\-]*\s+)?[\p{L}\-]*(?:[Ss]tra(?:ße|sse)|[Ss]tr\.|[Ww]eg|[Pp]latz|[Aa]llee|[Gg]asse|[Rr]ing|[Dd]amm|[Uu]fer|[Cc]haussee|[Pp]fad|[Ss]teig|[Hh]of|[Mm]arkt)\s*\d{1,4}\s?[a-zA-Z]?(?![\p{L}\d])/gu;
    const POSTCODE_CITY = /(?<!\d)\d{5}\s+\p{Lu}[\p{L}\-]+/gu;
    const EMAIL = /[\p{L}\d._%+\-]+@[\p{L}\d.\-]+\.\p{L}{2,}/gu;
    // Krankenversichertennummer: Buchstabe + 9 Ziffern
    const INSURANCE_NUMBER = /\b[A-Z]\d{9}\b/g;
    const CONTACT_PATTERNS = [EMAIL, INSURANCE_NUMBER, STREET, POSTCODE_CITY, PHONE];

    // Attribute, die angezeigt bzw. von KI-Tools gelesen, aber nie an den Server geschickt werden.
    // href nur bei tel:/mailto:-Links.
    const MASKED_ATTRIBUTES = ['title', 'aria-label', 'alt', 'placeholder', 'href'];
    const ATTRIBUTE_SELECTOR = '[title],[aria-label],[alt],[placeholder],[href^="tel:" i],[href^="mailto:" i]';

    // Text in diesen Elementen wird nie verändert: Eingaben würden sonst maskiert gespeichert.
    // option ohne value-Attribut sendet seinen Text als Wert mit.
    const SKIP_SELECTOR = [
        'script', 'style', 'noscript', 'template', 'textarea',
        '[contenteditable]:not([contenteditable="false"])',
        'option:not([value])',
        '[data-th-privacy]'
    ].join(',');

    // Wörter inkl. Apostroph-Namen ("D'Angelo")
    const TOKEN = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
    // E-Mail-Adressen, Benutzernamen: dort stehen Namen auch kleingeschrieben
    const ADDRESS = /[@_]|[\p{L}\d]\.\p{L}/u;
    const NAMES_STORAGE_KEY = 'terminheld_privacy_persons';
    const POSITION_STORAGE_KEY = 'terminheld_privacy_pos';

    // --- 3. HELPER ---
    // Vergleichsform: klein, ohne Akzente ("François" -> "francois", "Yılmaz" -> "yilmaz")
    function fold(word) {
        return word.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/ı/g, 'i').replace(/’/g, "'");
    }

    const ignoreList = new Set(ignoreWords.map(fold));

    function levenshtein(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        const matrix = [];
        for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
        for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
                }
            }
        }
        return matrix[b.length][a.length];
    }

    // Gelernte Namen (in Vergleichsform) und zu welcher Person sie gehören.
    // Pseudonyme statt Anfangsbuchstaben: Die KI kann Personen auseinanderhalten, aber nicht identifizieren.
    const tokenPersons = new Map();   // Name -> Personennummern (mehrere = mehrdeutig, z. B. gleicher Vorname)
    const personTokens = new Map();   // Personennummer -> Namen
    const namesByInitial = new Map();
    const learnedTexts = new Set();
    const matchCache = new Map();
    let personCount = 0;

    // Anreden und Titel: Großgeschriebene Wörter danach sind Namen, auch wenn sie nie gelernt wurden
    const SALUTATIONS = new Set(['frau', 'herr', 'herrn', 'fr', 'hr', 'familie', 'fam']);
    const TITLES = new Set(['dr', 'prof', 'med', 'dipl']);
    const ABBREVIATIONS = new Set(['fr', 'hr', 'fam', 'dr', 'prof', 'med', 'dipl']);
    const PLACEHOLDER = /\[(?:Person \d+|Name)\]/g;

    function linkName(folded, person) {
        if (!tokenPersons.has(folded)) {
            tokenPersons.set(folded, new Set());
            if (!namesByInitial.has(folded[0])) namesByInitial.set(folded[0], []);
            namesByInitial.get(folded[0]).push(folded);
        }
        tokenPersons.get(folded).add(person);
        if (!personTokens.has(person)) personTokens.set(person, new Set());
        personTokens.get(person).add(folded);
        personCount = Math.max(personCount, person);
    }

    function loadNames() {
        try {
            const saved = JSON.parse(sessionStorage.getItem(NAMES_STORAGE_KEY) || '[]');
            saved.forEach(([folded, persons]) => persons.forEach(person => linkName(folded, person)));
        } catch (e) { /* Speicher nicht verfügbar oder kaputt: neu lernen */ }
    }

    function saveNames() {
        try {
            const entries = [...tokenPersons].map(([folded, persons]) => [folded, [...persons]]);
            sessionStorage.setItem(NAMES_STORAGE_KEY, JSON.stringify(entries));
        } catch (e) { /* nur Komfort */ }
    }

    function isLowerCaseWord(word) {
        const firstChar = word[0];
        return (firstChar === firstChar.toLowerCase()) && (firstChar !== firstChar.toUpperCase());
    }

    // Liefert den gelernten Namen, dem das Wort entspricht, sonst null
    function findName(word, inAddress) {
        const folded = fold(word);
        if (folded.length < 2 || ignoreList.has(folded)) return null;

        // SMART CASING: kurz und kleingeschrieben -> wahrscheinlich Adjektiv/Verb ("zu laut").
        // Ausnahme: in E-Mail-Adressen sind Namen kleingeschrieben.
        if (isLowerCaseWord(word) && folded.length <= 4 && !inAddress) return null;

        if (tokenPersons.has(folded)) return folded;
        if (folded.length < 3) return null;

        // Tippfehler-Toleranz, nur bei gleichem Anfangsbuchstaben (Performance)
        for (const sensitive of namesByInitial.get(folded[0]) || []) {
            let allowedErrors = 0;
            if (sensitive.length > 4) allowedErrors = 1;
            if (sensitive.length > 7) allowedErrors = 2;
            if (allowedErrors === 0 || Math.abs(sensitive.length - folded.length) > allowedErrors) continue;
            if (levenshtein(sensitive, folded) <= allowedErrors) return sensitive;
        }
        return null;
    }

    function matchName(word, inAddress) {
        const key = (inAddress ? '@' : '') + word;
        if (!matchCache.has(key)) {
            if (matchCache.size > 20000) matchCache.clear();
            matchCache.set(key, findName(word, inAddress));
        }
        return matchCache.get(key);
    }

    // Personennummer eines Namens; 0 = mehrdeutig
    function personOf(folded) {
        const persons = tokenPersons.get(folded);
        return persons.size === 1 ? [...persons][0] : 0;
    }

    function placeholder(person) {
        return person ? `[Person ${person}]` : '[Name]';
    }

    // Wort (ohne Leerzeichen) um eine Textstelle herum, z. B. eine E-Mail-Adresse
    function chunkAround(text, start, end) {
        while (start > 0 && !/\s/.test(text[start - 1])) start--;
        while (end < text.length && !/\s/.test(text[end])) end++;
        return text.slice(start, end);
    }

    // Namen durch Pseudonyme ersetzen. "Frau Erika Musterfrau" -> "Frau [Person 3]"
    function maskNames(text) {
        const found = [];
        let afterSalutation = 0;   // wie viele folgende Wörter noch als Name gelten
        let previousWord = '';
        let previousEnd = 0;

        for (const match of text.matchAll(TOKEN)) {
            const word = match[0];
            const start = match.index;
            const end = start + word.length;
            const gap = text.slice(previousEnd, start);
            const lower = word.toLowerCase();

            // Die Anrede gilt nur für direkt folgende Wörter ("Dr." darf einen Punkt haben)
            const gapAllowed = /^\s+$/.test(gap) || (ABBREVIATIONS.has(previousWord) && /^\.\s*$/.test(gap));
            if (!gapAllowed) afterSalutation = 0;

            const inAddress = isLowerCaseWord(word) && word.length <= 4 && ADDRESS.test(chunkAround(text, start, end));
            const name = matchName(word, inAddress);
            if (name) {
                found.push({ start, end, person: personOf(name) });
            } else if (afterSalutation > 0 && !isLowerCaseWord(word) && !ignoreList.has(fold(word))) {
                found.push({ start, end, person: 0 });
            }

            if (SALUTATIONS.has(lower)) afterSalutation = 2;
            else if (!TITLES.has(lower) && afterSalutation > 0) afterSalutation--;
            previousWord = lower;
            previousEnd = end;
        }
        if (found.length === 0) return text;

        // Benachbarte Namensteile derselben Person zu einem Pseudonym zusammenfassen
        let result = '';
        let cursor = 0;
        let group = null;
        const flush = () => {
            if (!group) return;
            result += text.slice(cursor, group.start) + placeholder(group.person);
            cursor = group.end;
            group = null;
        };
        for (const part of found) {
            const adjacent = group && /^[\s,\-]*$/.test(text.slice(group.end, part.start));
            const samePerson = group && (!part.person || !group.person || part.person === group.person);
            if (adjacent && samePerson) {
                group.end = part.end;
                if (!group.person) group.person = part.person;
            } else {
                flush();
                group = { ...part };
            }
        }
        flush();
        return result + text.slice(cursor);
    }

    // Jedes Wort durch *** und jede Ziffer durch * ersetzen
    function maskAllCharacters(text) {
        return text.replace(/[\p{L}\p{M}]+|\d/gu, part => /\d/.test(part) ? '*' : '***');
    }

    function maskContactData(text) {
        if (!/[\d@]/.test(text)) return text;
        let result = text;
        for (const pattern of CONTACT_PATTERNS) {
            result = result.replace(pattern, match => {
                if (pattern === PHONE && match.replace(/\D/g, '').length < 7) return match;
                return maskAllCharacters(match);
            });
        }
        return result;
    }

    function maskText(text) {
        if (!text) return text;
        return maskNames(maskContactData(text));
    }

    // Inhalt eines Kontaktfelds: Namen als Pseudonym, alles andere außer Beschriftungen wie "(Privat)" als ***
    function maskContactField(text) {
        if (!text) return text;
        return maskText(text).split(/(\[(?:Person \d+|Name)\])/).map((part, i) => {
            if (i % 2 === 1) return part;
            return part.replace(/[\p{L}\p{M}]+|\d/gu, piece => {
                if (/\d/.test(piece)) return '*';
                return ignoreList.has(fold(piece)) ? piece : '***';
            });
        }).join('');
    }

    function isContactField(el) {
        return !!el.closest(FULL_MASK_SELECTOR);
    }

    // --- 4. LOGIK ---
    // Text einer Namensquelle (z. B. Listeneintrag) gehört zu genau einer Person
    function learnText(text) {
        text = text.replace(PLACEHOLDER, ' ');
        if (learnedTexts.has(text)) return false;
        if (learnedTexts.size > 5000) learnedTexts.clear();
        learnedTexts.add(text);

        const names = [];
        for (const word of text.match(TOKEN) || []) {
            const folded = fold(word);
            if (folded.length < 2 || ignoreList.has(folded)) continue;
            // Zweibuchstabige Namen ("Li", "Ng") nur, wenn großgeschrieben
            if (folded.length === 2 && isLowerCaseWord(word)) continue;
            if (!names.includes(folded)) names.push(folded);
        }
        if (names.length === 0) return false;

        // Bekannte Person, wenn ihre Namen und die des Textes ineinander enthalten sind
        // ("Erika Musterfrau" und später "Musterfrau, Erika" oder nur "Erika")
        const candidates = new Set();
        names.forEach(folded => (tokenPersons.get(folded) || []).forEach(person => candidates.add(person)));
        const matching = [...candidates].filter(person => {
            const known = personTokens.get(person);
            return [...known].every(folded => names.includes(folded)) || names.every(folded => known.has(folded));
        });
        const person = matching.length === 1 ? matching[0] : personCount + 1;

        let added = false;
        for (const folded of names) {
            if (!tokenPersons.has(folded) || !tokenPersons.get(folded).has(person)) {
                linkName(folded, person);
                added = true;
            }
        }
        return added;
    }

    function learnFrom(root) {
        const el = root.nodeType === Node.ELEMENT_NODE ? root : root.parentElement;
        if (!el) return false;
        let added = false;
        const learnSource = source => {
            if (!source.closest(SOURCE_EXCLUDE) && learnText(source.textContent)) added = true;
        };
        const source = el.closest(SOURCE_SELECTOR);
        if (source) learnSource(source);
        el.querySelectorAll(SOURCE_SELECTOR).forEach(learnSource);

        const calendars = el.closest(CALENDAR_SELECTOR) ? [el] : el.querySelectorAll(CALENDAR_SELECTOR);
        calendars.forEach(calendar => {
            const walker = document.createTreeWalker(calendar, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                for (const match of node.nodeValue.matchAll(CALENDAR_NAME)) {
                    if (learnText(match[0])) added = true;
                }
            }
        });

        if (added) {
            matchCache.clear();
            saveNames();
        }
        return added;
    }

    // Original und maskierte Fassung je Textknoten / Attribut, für Wiederherstellung
    const textCache = new Map();
    const attributeCache = new Map();

    function processTextNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest(SKIP_SELECTOR)) return;

        const current = node.nodeValue;
        const entry = textCache.get(node);
        // Hat Terminheld den Text inzwischen selbst geändert, gilt der neue Text als Original
        const original = (entry && current === entry.masked) ? entry.original : current;
        const masked = isContactField(parent) ? maskContactField(original) : maskText(original);

        if (masked === original) {
            textCache.delete(node);
            if (current !== original) node.nodeValue = original;
            return;
        }
        textCache.set(node, { original, masked });
        if (current !== masked) node.nodeValue = masked;
    }

    function processAttribute(el, name) {
        if (!el.hasAttribute(name) || el.closest('[data-th-privacy]')) return;

        const current = el.getAttribute(name);
        let entries = attributeCache.get(el);
        const entry = entries && entries.get(name);
        const original = (entry && current === entry.masked) ? entry.original : current;
        let masked = original;
        if (name !== 'href') {
            masked = maskText(original);
        } else if (/^(tel|mailto):/i.test(original)) {
            const scheme = original.slice(0, original.indexOf(':') + 1);
            masked = scheme + maskAllCharacters(original.slice(scheme.length));
        }

        if (masked === original) {
            if (entry) entries.delete(name);
            if (current !== original) el.setAttribute(name, original);
            return;
        }
        if (!entries) {
            entries = new Map();
            attributeCache.set(el, entries);
        }
        entries.set(name, { original, masked });
        if (current !== masked) el.setAttribute(name, masked);
    }

    function processSubtree(root) {
        if (root.nodeType === Node.TEXT_NODE) {
            processTextNode(root);
            return;
        }
        if (root.nodeType !== Node.ELEMENT_NODE) return;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) processTextNode(node);

        const elements = [root, ...root.querySelectorAll(ATTRIBUTE_SELECTOR)];
        elements.forEach(el => MASKED_ATTRIBUTES.forEach(name => processAttribute(el, name)));
    }

    // Einträge für Knoten, die nicht mehr auf der Seite sind, freigeben
    function pruneCaches() {
        for (const node of textCache.keys()) {
            if (!node.isConnected) textCache.delete(node);
        }
        for (const el of attributeCache.keys()) {
            if (!el.isConnected) attributeCache.delete(el);
        }
    }

    function fullPass() {
        learnFrom(document.documentElement);
        pruneCaches();
        processSubtree(document.documentElement);
        // Eigene Änderungen nicht erneut verarbeiten
        if (observer) observer.takeRecords();
    }

    // Läuft vor dem nächsten Zeichnen: neue Namen erscheinen nie im Klartext.
    // Verarbeitet nur geänderte Knoten; nur wenn ein neuer Name gelernt wurde, wird die ganze Seite geprüft.
    function handleMutations(records) {
        const roots = new Set();
        const attributeRecords = [];
        for (const record of records) {
            if (record.type === 'childList') {
                record.addedNodes.forEach(node => roots.add(node));
            } else if (record.type === 'characterData') {
                roots.add(record.target);
            } else {
                attributeRecords.push(record);
            }
        }

        let learned = false;
        for (const root of roots) {
            if (root.isConnected && learnFrom(root)) learned = true;
        }
        if (learned) {
            fullPass();
            return;
        }

        for (const root of roots) {
            if (root.isConnected) processSubtree(root);
        }
        for (const record of attributeRecords) {
            if (record.target.isConnected) processAttribute(record.target, record.attributeName);
        }
        observer.takeRecords();
    }

    function restoreOriginals() {
        for (const [node, entry] of textCache.entries()) {
            if (node.nodeValue === entry.masked) node.nodeValue = entry.original;
        }
        for (const [el, entries] of attributeCache.entries()) {
            for (const [name, entry] of entries.entries()) {
                if (el.getAttribute(name) === entry.masked) el.setAttribute(name, entry.original);
            }
        }
        textCache.clear();
        attributeCache.clear();
    }

    function toggleAnonymizationState(active) {
        isAnonymized = active;
        if (isAnonymized) {
            if (!observer) {
                observer = new MutationObserver(handleMutations);
                observer.observe(document.documentElement, {
                    childList: true, subtree: true, characterData: true,
                    attributes: true, attributeFilter: MASKED_ATTRIBUTES
                });
            }
            fullPass();
        } else {
            if (observer) {
                observer.disconnect();
                observer = null;
            }
            restoreOriginals();
        }
    }

    // --- 5. UI (RDP & Keybinds) ---
    const toggleBtn = document.createElement('div');
    toggleBtn.setAttribute('data-th-privacy', '');

    function renderButton(locked) {
        toggleBtn.innerHTML = locked ? `
            <span style="cursor:pointer; font-size:14px;">🔒 KI-SCHUTZ</span>
            <div style="font-size:10px; opacity:0.8; margin-top:3px;">(Alt + X)</div>
        ` : `
            <span style="cursor:pointer; font-size:14px;">⚠️ UNSICHER</span>
            <div style="font-size:10px;">(Auto-Lock 30s)</div>
        `;
        toggleBtn.style.background = locked ? '#1b5e20' : '#d32f2f';
        toggleBtn.classList.toggle('th-alert-mode', !locked);
    }

    let savedPos = null;
    try {
        savedPos = JSON.parse(localStorage.getItem(POSITION_STORAGE_KEY));
    } catch (e) { /* kaputter Wert: Standardposition */ }
    if (!savedPos || typeof savedPos.top !== 'string' || typeof savedPos.left !== 'string') {
        savedPos = { top: '80px', left: '20px' };
    }

    toggleBtn.style.cssText = `
        position: fixed; top: ${savedPos.top}; left: ${savedPos.left};
        z-index: 2147483647; padding: 14px 20px;
        color: white; border-radius: 10px;
        cursor: move; font-family: sans-serif; font-weight: bold;
        text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        user-select: none; transition: background 0.3s; min-width: 120px;
        border: 2px solid transparent;
    `;
    renderButton(true);

    // Nach Auflösungswechsel (RDP) den Button zurück in den sichtbaren Bereich holen
    function keepButtonOnScreen() {
        const rect = toggleBtn.getBoundingClientRect();
        const maxLeft = Math.max(0, window.innerWidth - rect.width);
        const maxTop = Math.max(0, window.innerHeight - rect.height);
        toggleBtn.style.left = `${Math.min(Math.max(rect.left, 0), maxLeft)}px`;
        toggleBtn.style.top = `${Math.min(Math.max(rect.top, 0), maxTop)}px`;
    }

    let autoTimer = null;
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    document.addEventListener('keydown', function(e) {
        if (e.altKey && e.code === 'KeyX' && !e.repeat) {
            e.preventDefault();
            performToggle();
        }
    });

    toggleBtn.addEventListener('mousedown', function(e) {
        isDragging = false;
        startX = e.clientX;
        startY = e.clientY;
        const rect = toggleBtn.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            isDragging = true;
            toggleBtn.style.top = `${initialTop + dy}px`;
            toggleBtn.style.left = `${initialLeft + dx}px`;
        }
    }

    function onMouseUp(e) {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (isDragging) {
            keepButtonOnScreen();
            try {
                localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify({
                    top: toggleBtn.style.top, left: toggleBtn.style.left
                }));
            } catch (err) { /* Position nur Komfort */ }
        } else {
            performToggle();
        }
    }

    function performToggle() {
        if (isAnonymized) {
            if (confirm('⚠️ ACHTUNG: KI-Schutz deaktivieren?')) {
                toggleAnonymizationState(false);
                renderButton(false);

                if (autoTimer) clearTimeout(autoTimer);
                autoTimer = setTimeout(() => {
                    toggleAnonymizationState(true);
                    renderButton(true);
                }, 30000);
            }
        } else {
            if (autoTimer) clearTimeout(autoTimer);
            toggleAnonymizationState(true);
            renderButton(true);
        }
    }

    // --- 6. START ---
    // Schutz sofort aktiv (document-start), nicht erst nach dem Laden
    loadNames();
    toggleAnonymizationState(true);

    function mountButton() {
        document.body.appendChild(toggleBtn);
        keepButtonOnScreen();
    }
    if (document.body) {
        mountButton();
    } else {
        document.addEventListener('DOMContentLoaded', mountButton);
    }
    window.addEventListener('resize', keepButtonOnScreen);

    // Sicherheitsnetz für Änderungen, die der Observer nicht meldet
    setInterval(() => { if (isAnonymized && !document.hidden) fullPass(); }, 3000);

})();
