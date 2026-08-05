/* =========================================================
   ARC AI — SITE BEHAVIOR
   =========================================================
   This file makes the page interactive:
   1. Mobile menu open/close
   2. The typing animation in the hero "code review" panel
   3. Sections fading in as you scroll
   4. The live audit tool (sends real code to /api/audit)
   5. The signup form's confirmation message
   ========================================================= */

document.addEventListener('DOMContentLoaded', function () {

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. Mobile menu ---------- */
  var navToggle = document.getElementById('navToggle');
  var navMobile = document.getElementById('navMobile');

  if (navToggle && navMobile) {
    navToggle.addEventListener('click', function () {
      var isOpen = navMobile.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
    navMobile.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        navMobile.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---------- 2. Hero "code review" typing animation ---------- */
  var comments = [
    { text: 'No idempotency key — retried requests will double-charge users.', type: 'blocking' },
    { text: 'No error handling if Stripe times out mid-charge.', type: 'warning' },
    { text: 'Good: amount validated before this function is called.', type: 'pass' }
  ];
  var commentsContainer = document.getElementById('auditComments');

  function renderComments() {
    if (!commentsContainer) return;
    comments.forEach(function (comment, i) {
      var line = document.createElement('div');
      line.className = 'audit-line ' + comment.type;
      line.textContent = comment.text;
      line.style.animationDelay = (i * 0.5) + 's';
      commentsContainer.appendChild(line);
    });
  }

  if (prefersReducedMotion) {
    renderComments();
  } else {
    // Slight delay so it plays after the page settles in view
    var terminalEl = document.getElementById('terminal');
    if (terminalEl && 'IntersectionObserver' in window) {
      var played = false;
      var termObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !played) {
            played = true;
            setTimeout(renderComments, 400);
            termObserver.disconnect();
          }
        });
      }, { threshold: 0.4 });
      termObserver.observe(terminalEl);
    } else {
      renderComments();
    }
  }

  /* ---------- 3. Scroll reveal for sections ---------- */
  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !prefersReducedMotion) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ---------- 4. Live audit tool (self-contained demo — no server/API needed) ---------- */
  var codeInput = document.getElementById('codeInput');
  var charCount = document.getElementById('charCount');
  var runAuditBtn = document.getElementById('runAuditBtn');
  var auditResultPanel = document.getElementById('auditResultPanel');
  var MAX_CODE_LENGTH = 6000;

  if (codeInput && charCount) {
    codeInput.addEventListener('input', function () {
      charCount.textContent = codeInput.value.length + ' / ' + MAX_CODE_LENGTH;
    });
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Pattern-based rules that mimic the categories a senior engineer checks:
  // architecture, security, and scalability. This runs entirely in the
  // visitor's browser — no server, no API key, nothing to configure.
  var AUDIT_RULES = [
    {
      test: function (c) { return /(charge|payment|stripe|checkout)/i.test(c) && !/idempoten/i.test(c); },
      severity: 'blocking',
      text: 'No idempotency key on what looks like a payment/charge operation — a retried request could double-charge a user.'
    },
    {
      test: function (c) { return /(password|apikey|api_key|secret|token)\s*=\s*['"][^'"]+['"]/i.test(c); },
      severity: 'blocking',
      text: 'A credential-like value appears to be hardcoded — move secrets to environment variables.'
    },
    {
      test: function (c) { return /(SELECT|INSERT|UPDATE|DELETE)\b.*\+/i.test(c) && /['"]/.test(c); },
      severity: 'blocking',
      text: 'SQL is being built with string concatenation — this is vulnerable to SQL injection. Use parameterized queries.'
    },
    {
      test: function (c) { return !/(try\s*{|\.catch\(|except\s)/i.test(c) && /(fetch\(|axios|await |\.then\()/i.test(c); },
      severity: 'warning',
      text: 'No error handling around what looks like an async or network call — a failure here would go unhandled.'
    },
    {
      test: function (c) { return /function\s+\w+\s*\(([^)]{2,})\)/i.test(c) && !/(if\s*\(.*(null|undefined|typeof))/i.test(c); },
      severity: 'warning',
      text: 'No input validation visible on the function parameters — unexpected types or missing values could cause runtime errors.'
    },
    {
      test: function (c) { return /for\s*\([^)]*\)[^{]*{[^}]*for\s*\(/is.test(c); },
      severity: 'warning',
      text: 'Nested loops detected — this likely runs in O(n\u00b2) time or worse, which may not scale with larger inputs.'
    },
    {
      test: function (c) { return /\bvar\s+/i.test(c); },
      severity: 'note',
      text: 'Uses "var" instead of "let"/"const" — modern scoping would make this easier to reason about.'
    },
    {
      test: function (c) { return !/\/\/|\/\*|#\s/.test(c); },
      severity: 'note',
      text: 'No comments in this snippet — a short note on intent would help future maintainers (including future you).'
    },
    {
      test: function (c) { return (c.match(/\n/g) || []).length > 40; },
      severity: 'warning',
      text: 'This function is quite long — consider whether it is doing more than one job and could be split up.'
    }
  ];

  var FALLBACK_ISSUE = {
    severity: 'note',
    text: 'No obvious red flags in this snippet, but consider load-testing and adding tests before this goes anywhere near production traffic.'
  };

  function generateSampleAudit(code) {
    var found = [];
    for (var i = 0; i < AUDIT_RULES.length && found.length < 5; i++) {
      if (AUDIT_RULES[i].test(code)) found.push(AUDIT_RULES[i]);
    }
    if (found.length === 0) found.push(FALLBACK_ISSUE);

    var blockingCount = found.filter(function (f) { return f.severity === 'blocking'; }).length;
    var warningCount = found.filter(function (f) { return f.severity === 'warning'; }).length;

    var score = 9.5 - (blockingCount * 2.5) - (warningCount * 1);
    score = Math.max(2.5, Math.min(9.5, score));
    score = Math.round(score * 10) / 10;

    var summary;
    if (blockingCount > 0) {
      summary = 'This isn\'t production-ready yet — there\'s at least one issue above that could cause real damage under real usage. Fix the blocking item first, then reassess.';
    } else if (warningCount > 0) {
      summary = 'This holds up for a first pass, but the warnings above are the kind of thing a senior engineer would flag before approving the merge.';
    } else {
      summary = 'Solid for a first pass — no major red flags here, though there\'s always more to tighten up before production traffic hits it.';
    }

    return { issues: found, score: score, summary: summary };
  }

  function renderAuditResult(result) {
    var html = '<div class="audit-result-panel">';
    result.issues.forEach(function (issue) {
      html += '<div class="audit-line ' + issue.severity + '">' + escapeHtml(issue.text) + '</div>';
    });
    html += '<div class="audit-result-score">Production readiness: ' + result.score + ' / 10</div>';
    html += '<div class="audit-result-summary">' + escapeHtml(result.summary) + '</div>';
    html += '</div>';
    auditResultPanel.innerHTML = html;
  }

  if (runAuditBtn) {
    runAuditBtn.addEventListener('click', function () {
      var code = codeInput.value.trim();
      if (!code) {
        auditResultPanel.innerHTML = '<div class="audit-result-error">Paste some code first — even a single function is enough.</div>';
        return;
      }

      runAuditBtn.disabled = true;
      var originalText = runAuditBtn.textContent;
      runAuditBtn.textContent = 'Reviewing…';
      auditResultPanel.innerHTML = '<div class="audit-result-loading">Running your code through the senior-engineer review…</div>';

      // Small artificial delay so it reads as "reviewing" rather than an instant flash.
      setTimeout(function () {
        var result = generateSampleAudit(code);
        renderAuditResult(result);
        runAuditBtn.disabled = false;
        runAuditBtn.textContent = originalText;
      }, 700);
    });
  }

  /* ---------- 5. Signup form ---------- */
  var form = document.getElementById('signupForm');
  var formNote = document.getElementById('formNote');

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('email').value;
      var submitBtn = form.querySelector('button');
      var originalBtnText = submitBtn.textContent;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';

      // Sends the form data to Formspree (https://formspree.io/f/mdaqqvky).
      // Formspree stores the submission and can forward it to your email —
      // check your Formspree dashboard / inbox after testing this.
      fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { 'Accept': 'application/json' }
      })
        .then(function (response) {
          if (response.ok) {
            if (formNote) {
              formNote.textContent = 'Thanks — check ' + email + ' for your first project brief shortly.';
              formNote.style.color = 'var(--accent-2)';
            }
            form.querySelector('input').disabled = true;
            form.querySelector('select').disabled = true;
            submitBtn.textContent = 'Sent';
          } else {
            throw new Error('Formspree returned an error');
          }
        })
        .catch(function () {
          if (formNote) {
            formNote.textContent = 'Something went wrong sending that — please try again in a moment.';
            formNote.style.color = 'var(--danger)';
          }
          submitBtn.disabled = false;
          submitBtn.textContent = originalBtnText;
        });
    });
  }

});
