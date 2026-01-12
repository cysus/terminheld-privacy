// ==UserScript==
// @name         TERMINHELD Privacy V21 (Bugfix & Stable)
// @namespace    https://github.com/cysus/terminheld-privacy
// @version      21.0.0
// @description  Fix für V20-Absturz. Unterscheidet Namen (Groß) von Adjektiven (klein). RDP-Optimiert.
// @match        https://mein.terminheld.de/*
// @updateURL    https://raw.githubusercontent.com/cysus/terminheld-privacy/main/terminheld-privacy.user.js
// @downloadURL  https://raw.githubusercontent.com/cysus/terminheld-privacy/main/terminheld-privacy.user.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    let isAnonymized = true;
    let observer = null;

    // --- 1. CSS (Touch & Wackel-Effekt) ---
    const styleSheet = document.createElement("style");
    styleSheet.innerText = `
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
    document.head.appendChild(styleSheet);

    // --- 2. LISTEN ---
    const nodeCache = new Map();
    const sensitiveWordsSet = new Set();

    // Reduzierte Ignore-Liste (Da Smart-Casing jetzt Adjektive filtert)
    const ignoreList = new Set([
        // Struktur
        'familie', 'herr', 'frau', 'dr.', 'dr', 'prof.', 'von', 'und', 'oder',
        'der', 'die', 'das', 'dem', 'den', 'zu', 'im', 'in', 'am', 'mit', 'auf',
        // Kontakt & UI
        'tel', 'mobil', 'fax', 'mail', 'email', 'straße', 'str.', 'nr',
        'privat', 'geschäftlich', 'termin', 'datum', 'uhrzeit', 'patient',
        'behandlung', 'diagnose', 'rezept', 'alter', 'geb', 'geb.',
        'kalender', 'lupe', 'kontakte', 'suche', 'einstellungen', 'hilfe',
        'dashboard', 'startseite', 'logout', 'abmelden', 'anmelden', 'profil',
        'menü', 'navigation', 'ansicht', 'tag', 'woche', 'monat', 'liste', 'foto', 'vom',
        // Verben & Füllwörter
        'sehr', 'geehrte', 'geehrter', 'hallo', 'guten', 'heute', 'gestern', 'morgen',
        'startet', 'zeigt', 'sich', 'nicht', 'aber', 'auch', 'dass', 'wenn', 'dann',
        'weil', 'war', 'ist', 'hat', 'wurde', 'wird', 'kann', 'soll', 'muss',
        // Medizinisch / Therapie
        'therapie', 'bericht', 'befund', 'logopädie', 'ergotherapie', 'physiotherapie',
        'sprache', 'sprechen', 'laut', 'leise', 'stimme', 'klang', 'ton',
        'entwicklung', 'stand', 'ziel', 'maßnahme', 'wortschatz', 'wörter', 'wort',
        'motorik', 'grobmotorik', 'feinmotorik', 'wahrnehmung', 'konzentration',
        'eltern', 'mutter', 'vater', 'kind', 'bruder', 'schwester'
    ]);

    const sourceSelectors = [
        '.ListItem-content-title',
        '#MagnifierObjectCard .generic',
        '.ContactFileTab h2',
        '.fc-event-title',
        '.t-card-title'
    ];

    // --- 3. HELPER ---
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

    function isSimilarToSensitive(word) {
        if (word.length < 3) return false;
        const lowerWord = word.toLowerCase();

        if (ignoreList.has(lowerWord)) return false;

        for (let sensitive of sensitiveWordsSet) {
            // Nur prüfen, wenn erster Buchstabe gleich ist (Performance)
            if (sensitive.toLowerCase()[0] !== lowerWord[0]) continue;

            const dist = levenshtein(sensitive.toLowerCase(), lowerWord);

            // Toleranz
            let allowedErrors = 0;
            if (sensitive.length > 4) allowedErrors = 1;
            if (sensitive.length > 7) allowedErrors = 2;

            if (dist <= allowedErrors) return true;
        }
        return false;
    }

    function getMaskedString(word) {
        if (word.length <= 1) return word;
        return word[0] + '*'.repeat(Math.min(word.length - 1, 5));
    }

    // --- 4. LOGIK ---
    function identifyNames() {
        sourceSelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                const text = el.innerText.trim();
                if (text && text.length > 2 && !text.includes('****')) {
                    const parts = text.split(/[\s,\.\(\)\-]+/);
                    parts.forEach(part => {
                        const cleanPart = part.replace(/[^a-zA-ZäöüÄÖÜß]/g, '');
                        if (cleanPart.length > 2) {
                            const lower = cleanPart.toLowerCase();
                            if (!ignoreList.has(lower)) {
                                sensitiveWordsSet.add(cleanPart);
                            }
                        }
                    });
                }
            });
        });
    }

    function redactGlobally() {
        if (sensitiveWordsSet.size === 0) return;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            if (node.parentElement && ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.parentElement.tagName)) continue;

            let currentText = node.nodeValue;
            let originalText = currentText;
            if (nodeCache.has(node)) originalText = nodeCache.get(node);

            let words = originalText.split(/([\s,\.\(\)\!\?\-]+)/);
            let needsReplacement = false;

            let modifiedWords = words.map(word => {
                const cleanWord = word.replace(/[^a-zA-ZäöüÄÖÜß]/g, '');

                // BUGFIX V21: Zuerst prüfen, ob überhaupt ein Wort da ist
                if (cleanWord.length < 2) return word;

                // SMART CASING CHECK:
                // Wenn Wort kurz (<=4) UND Kleingeschrieben -> Wahrscheinlich Adjektiv/Verb ("laut", "hell")
                // Ausnahme: ignoreList prüft eh später noch
                const isShort = cleanWord.length <= 4;
                const firstChar = cleanWord[0];
                const isLowerCase = (firstChar === firstChar.toLowerCase()) && (firstChar !== firstChar.toUpperCase());

                if (isShort && isLowerCase) {
                    // Das Wort ist klein geschrieben und kurz -> Ignorieren (z.B. "zu laut")
                    return word;
                }

                // Normaler Check
                if (!ignoreList.has(cleanWord.toLowerCase())) {
                    if (isSimilarToSensitive(cleanWord)) {
                        needsReplacement = true;
                        return word.replace(cleanWord, getMaskedString(cleanWord));
                    }
                }
                return word;
            });

            if (needsReplacement) {
                const newText = modifiedWords.join('');
                if (currentText !== newText) {
                    if (!nodeCache.has(node)) nodeCache.set(node, originalText);
                    node.nodeValue = newText;
                }
            }
        }
    }

    function executePrivacyLoop() {
        identifyNames();
        redactGlobally();
    }

    function restoreOriginals() {
        for (const [node, originalText] of nodeCache.entries()) {
            node.nodeValue = originalText;
        }
    }

    function toggleAnonymizationState(active) {
        isAnonymized = active;
        if (isAnonymized) {
            executePrivacyLoop();
            if (!observer) {
                observer = new MutationObserver(() => executePrivacyLoop());
                observer.observe(document.body, { childList: true, subtree: true, characterData: true });
            }
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
    toggleBtn.innerHTML = `
        <span style="cursor:pointer; font-size:14px;">🔒 KI-SCHUTZ</span>
        <div style="font-size:10px; opacity:0.8; margin-top:3px;">(Alt + X)</div>
    `;

    const savedPos = JSON.parse(localStorage.getItem('terminheld_privacy_pos')) || { top: '80px', left: '20px' };

    toggleBtn.style.cssText = `
        position: fixed; top: ${savedPos.top}; left: ${savedPos.left};
        z-index: 2147483647; padding: 14px 20px;
        background: #1b5e20; color: white; border-radius: 10px;
        cursor: move; font-family: sans-serif; font-weight: bold;
        text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        user-select: none; transition: background 0.3s; min-width: 120px;
        border: 2px solid transparent;
    `;

    let autoTimer = null;
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    document.addEventListener('keydown', function(e) {
        if (e.altKey && e.code === 'KeyX') {
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
            localStorage.setItem('terminheld_privacy_pos', JSON.stringify({
                top: toggleBtn.style.top, left: toggleBtn.style.left
            }));
        } else {
            performToggle();
        }
    }

    function performToggle() {
        if (isAnonymized) {
            if (confirm('⚠️ ACHTUNG: KI-Schutz deaktivieren?')) {
                toggleAnonymizationState(false);
                toggleBtn.innerHTML = `
                    <span style="cursor:pointer; font-size:14px;">⚠️ UNSICHER</span>
                    <div style="font-size:10px;">(Auto-Lock 30s)</div>
                `;
                toggleBtn.style.background = '#d32f2f';
                toggleBtn.classList.add('th-alert-mode');

                if (autoTimer) clearTimeout(autoTimer);
                autoTimer = setTimeout(() => {
                    toggleAnonymizationState(true);
                    resetButton();
                }, 30000);
            }
        } else {
            if (autoTimer) clearTimeout(autoTimer);
            toggleAnonymizationState(true);
            resetButton();
        }
    }

    function resetButton() {
        toggleBtn.innerHTML = `
            <span style="cursor:pointer; font-size:14px;">🔒 KI-SCHUTZ</span>
            <div style="font-size:10px; opacity:0.8; margin-top:3px;">(Alt + X)</div>
        `;
        toggleBtn.style.background = '#1b5e20';
        toggleBtn.classList.remove('th-alert-mode');
    }

    setTimeout(() => {
        document.body.appendChild(toggleBtn);
        setInterval(() => { if(isAnonymized) executePrivacyLoop(); }, 3000);
        toggleAnonymizationState(true);
    }, 1000);

})();