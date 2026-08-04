/* ==========================================================================
   ARC AI — INTERACTIVE SITE LOGIC & AUDIT ENGINE
   --------------------------------------------------------------------------
   Powers:
   1. Interactive Code Audit Sandbox (preset switching, live AST scanning, refactor toggle)
   2. Interactive Mock Interview Simulator (multi-turn AI dialogue & scoring)
   3. Project Brief Spec Modal Viewer
   4. Early Access Lead Form & Toast Notifications
   5. Mobile Drawer Navigation
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

  /* ================= 1. SCENARIO DATA FOR CODE AUDIT ================= */
  const SCENARIOS = {
    stripe: {
      fileName: 'payment_webhook.ts',
      scoreInitial: '4.8/10',
      scoreFixed: '9.8/10',
      flawedLines: [3, 6],
      codeFlawed: [
        '<span class="kw">async function</span> <span class="fn">handlePaymentWebhook</span>(req: Request) {',
        '  <span class="kw">const</span> { userId, amount, currency } = req.body;',
        '  ',
        '  <span class="cm">// ❌ FLAW 1: Direct charge without idempotency key</span>',
        '  <span class="flaw-line"><span class="kw">const</span> charge = <span class="kw">await</span> stripe.charges.create({ amount, currency, customer: userId });</span>',
        '  ',
        '  <span class="cm">// ❌ FLAW 2: No DB transaction isolation or network retry logic</span>',
        '  <span class="flaw-line"><span class="kw">await</span> db.user.update({ where: { id: userId }, data: { status: <span class="str">"active"</span> } });</span>',
        '  ',
        '  <span class="kw">return</span> { success: <span class="kw">true</span>, chargeId: charge.id };',
        '}'
      ].join('\n'),
      codeFixed: [
        '<span class="kw">async function</span> <span class="fn">handlePaymentWebhook</span>(req: Request) {',
        '  <span class="kw">const</span> { userId, amount, currency, idempotencyKey } = req.body;',
        '  ',
        '  <span class="cm">// ✅ SENIOR FIX 1: Pass Idempotency Key to prevent double charges</span>',
        '  <span class="fix-line"><span class="kw">const</span> charge = <span class="kw">await</span> stripe.charges.create({ amount, currency, customer: userId }, { idempotencyKey });</span>',
        '  ',
        '  <span class="cm">// ✅ SENIOR FIX 2: Wrapped in Atomic DB Transaction</span>',
        '  <span class="fix-line"><span class="kw">return await</span> db.$transaction(<span class="kw">async</span> (tx) => {</span>',
        '    <span class="kw">await</span> tx.user.update({ where: { id: userId }, data: { status: <span class="str">"active"</span> } });',
        '    <span class="kw">return</span> { success: <span class="kw">true</span>, chargeId: charge.id };',
        '  });',
        '}'
      ].join('\n'),
      comments: [
        { type: 'blocking', title: 'BLOCKING // Missing Idempotency Key', text: 'Network timeouts will cause payment retries to double-charge users. Always pass an idempotency header to Stripe.' },
        { type: 'blocking', title: 'BLOCKING // Non-Atomic DB Operation', text: 'If DB update fails after charging Stripe, the user is charged without getting access. Wrap DB update in a transaction.' },
        { type: 'warning', title: 'WARN // Unhandled Timeout Error', text: 'No retry or fallback mechanism if Stripe gateway experiences transient 504 gateway timeout.' }
      ]
    },
    jwt: {
      fileName: 'auth_middleware.go',
      scoreInitial: '3.5/10',
      scoreFixed: '9.5/10',
      flawedLines: [4, 7],
      codeFlawed: [
        '<span class="kw">func</span> <span class="fn">AuthMiddleware</span>(next http.Handler) http.Handler {',
        '  <span class="kw">return</span> http.HandlerFunc(<span class="kw">func</span>(w http.ResponseWriter, r *http.Request) {',
        '    tokenStr := r.Header.Get(<span class="str">"Authorization"</span>)',
        '    ',
        '    <span class="cm">// ❌ FLAW 1: Parsing token without verifying signature algorithm</span>',
        '    <span class="flaw-line">token, _ := jwt.Parse(tokenStr, <span class="kw">func</span>(t *jwt.Token) (interface{}, error) {</span>',
        '      <span class="kw">return</span> []byte(secret), nil',
        '    })',
        '    ',
        '    <span class="cm">// ❌ FLAW 2: Missing expiration check</span>',
        '    <span class="flaw-line">claims := token.Claims.(jwt.MapClaims)</span>',
        '    next.ServeHTTP(w, r)',
        '  })',
        '}'
      ].join('\n'),
      codeFixed: [
        '<span class="kw">func</span> <span class="fn">AuthMiddleware</span>(next http.Handler) http.Handler {',
        '  <span class="kw">return</span> http.HandlerFunc(<span class="kw">func</span>(w http.ResponseWriter, r *http.Request) {',
        '    tokenStr := strings.TrimPrefix(r.Header.Get(<span class="str">"Authorization"</span>), <span class="str">"Bearer "</span>)',
        '    ',
        '    <span class="cm">// ✅ SENIOR FIX 1: Enforce HMAC SHA256 signature algorithm</span>',
        '    <span class="fix-line">token, err := jwt.Parse(tokenStr, <span class="kw">func</span>(t *jwt.Token) (interface{}, error) {</span>',
        '      <span class="kw">if</span> _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {',
        '        <span class="kw">return</span> nil, fmt.Errorf(<span class="str">"unexpected alg: %v"</span>, t.Header[<span class="str">"alg"</span>])',
        '      }',
        '      <span class="kw">return</span> []byte(secret), nil',
        '    })',
        '    <span class="cm">// ✅ SENIOR FIX 2: Validate token claims & expiration</span>',
        '    <span class="fix-line"><span class="kw">if</span> err != nil || !token.Valid { http.Error(w, <span class="str">"Unauthorized"</span>, 401); <span class="kw">return</span> }</span>',
        '    next.ServeHTTP(w, r)',
        '  })',
        '}'
      ].join('\n'),
      comments: [
        { type: 'blocking', title: 'CRITICAL // Algorithm Confusion Vulnerability', text: 'Accepting `alg: none` or RSA public keys as HMAC secrets allows attackers to forge valid admin JWTs.' },
        { type: 'blocking', title: 'BLOCKING // Missing Expiration Check', text: 'Expired JWT tokens remain permanently valid because claims validation is ignored.' }
      ]
    },
    rate_limit: {
      fileName: 'rate_limiter.rs',
      scoreInitial: '5.2/10',
      scoreFixed: '9.9/10',
      flawedLines: [5, 8],
      codeFlawed: [
        '<span class="kw">pub async fn</span> <span class="fn">check_rate_limit</span>(client_ip: &str) -> <span class="kw">Result</span>&lt;bool, Error&gt; {',
        '  <span class="kw">let mut</span> conn = REDIS_POOL.get().<span class="kw">await</span>?;',
        '  <span class="kw">let</span> count: i32 = conn.get(client_ip).<span class="kw">await</span>?.unwrap_or(0);',
        '  ',
        '  <span class="cm">// ❌ FLAW 1: Non-atomic increment causes race conditions</span>',
        '  <span class="flaw-line"><span class="kw">if</span> count &gt; 100 { <span class="kw">return</span> Ok(<span class="kw">false</span>); }</span>',
        '  <span class="flaw-line">conn.set(client_ip, count + 1).<span class="kw">await</span>?;</span>',
        '  Ok(<span class="kw">true</span>)',
        '}'
      ].join('\n'),
      codeFixed: [
        '<span class="kw">pub async fn</span> <span class="fn">check_rate_limit</span>(client_ip: &str) -> <span class="kw">Result</span>&lt;bool, Error&gt; {',
        '  <span class="kw">let mut</span> conn = REDIS_POOL.get().<span class="kw">await</span>?;',
        '  ',
        '  <span class="cm">// ✅ SENIOR FIX: Atomic Redis EVAL SHA script with Lua token bucket</span>',
        '  <span class="fix-line"><span class="kw">let</span> current: i64 = conn.incr(client_ip, 1).<span class="kw">await</span>?;</span>',
        '  <span class="fix-line"><span class="kw">if</span> current == 1 { conn.expire(client_ip, 60).<span class="kw">await</span>?; }</span>',
        '  ',
        '  Ok(current &lt;= 100)',
        '}'
      ].join('\n'),
      comments: [
        { type: 'blocking', title: 'BLOCKING // TOCTOU Race Condition', text: 'Separate GET and SET commands allow concurrent requests to bypass rate limits entirely.' },
        { type: 'warning', title: 'WARN // Unbounded Key TTL', text: 'Keys created without TTL will stay in Redis memory forever until eviction.' }
      ]
    }
  };

  /* ================= CODE PLAYGROUND LOGIC ================= */
  let currentScenarioKey = 'stripe';
  let isShowingFix = false;

  const codeDisplay = document.getElementById('codeDisplay');
  const lineNumbers = document.getElementById('lineNumbers');
  const auditFeed = document.getElementById('auditFeed');
  const scoreValue = document.getElementById('scoreValue');
  const scanBeam = document.getElementById('scanBeam');
  const scanProgressContainer = document.getElementById('scanProgressContainer');
  const scanProgressBar = document.getElementById('scanProgressBar');
  const scanStatusText = document.getElementById('scanStatusText');
  const runAuditBtn = document.getElementById('runAuditBtn');
  const toggleFixBtn = document.getElementById('toggleFixBtn');
  const fixBtnText = document.getElementById('fixBtnText');

  function renderScenario(key, showFixed = false) {
    const scenario = SCENARIOS[key];
    const codeText = showFixed ? scenario.codeFixed : scenario.codeFlawed;
    
    codeDisplay.innerHTML = codeText;

    // Render Line Numbers
    const lineCount = codeText.split('\n').length;
    let lineNumsHTML = '';
    for (let i = 1; i <= lineCount; i++) {
      lineNumsHTML += `${i}\n`;
    }
    lineNumbers.textContent = lineNumsHTML;

    // Update Score
    scoreValue.textContent = showFixed ? scenario.scoreFixed : scenario.scoreInitial;

    // Render Audit Comments
    auditFeed.innerHTML = '';
    if (showFixed) {
      const passCard = document.createElement('div');
      passCard.className = 'audit-card pass';
      passCard.innerHTML = `
        <span class="audit-card-tag">✓ PASSED // Production Ready</span>
        <div class="audit-card-text">All blocking vulnerability checks resolved. Idempotency enforced and atomic transactions active.</div>
      `;
      auditFeed.appendChild(passCard);
    } else {
      scenario.comments.forEach((c, idx) => {
        const card = document.createElement('div');
        card.className = `audit-card ${c.type}`;
        card.style.animationDelay = `${idx * 0.15}s`;
        card.innerHTML = `
          <span class="audit-card-tag">${c.title}</span>
          <div class="audit-card-text">${c.text}</div>
        `;
        auditFeed.appendChild(card);
      });
    }
  }

  // Tab Switch Handler
  const tabs = document.querySelectorAll('.terminal-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      currentScenarioKey = tab.dataset.scenario;
      isShowingFix = false;
      fixBtnText.textContent = 'Compare Senior Refactor';
      renderScenario(currentScenarioKey, false);
    });
  });

  // Toggle Fix Handler
  toggleFixBtn.addEventListener('click', () => {
    isShowingFix = !isShowingFix;
    fixBtnText.textContent = isShowingFix ? 'View Flawed Code' : 'Compare Senior Refactor';
    renderScenario(currentScenarioKey, isShowingFix);
    showToast(isShowingFix ? 'Showing Production-Ready Refactor' : 'Showing Flawed Original Code');
  });

  // Run Audit Animation
  runAuditBtn.addEventListener('click', () => {
    runAuditBtn.disabled = true;
    scanBeam.classList.add('active');
    scanProgressContainer.style.display = 'flex';
    scanProgressBar.style.width = '0%';
    auditFeed.innerHTML = '<div class="audit-card-text" style="color: var(--text-muted); font-family: var(--font-mono);">AST parsing in progress...</div>';

    let progress = 0;
    const interval = setInterval(() => {
      progress += 25;
      scanProgressBar.style.width = `${progress}%`;

      if (progress === 50) {
        scanStatusText.textContent = 'Checking race conditions & boundary limits...';
      } else if (progress === 75) {
        scanStatusText.textContent = 'Synthesizing Staff Engineer PR review...';
      } else if (progress >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          scanBeam.classList.remove('active');
          scanProgressContainer.style.display = 'none';
          runAuditBtn.disabled = false;
          renderScenario(currentScenarioKey, isShowingFix);
          showToast('AI Code Audit Complete!');
        }, 300);
      }
    }, 250);
  });

  /* Initial Render */
  renderScenario('stripe', false);


  /* ================= 2. MOCK INTERVIEW SIMULATOR LOGIC ================= */
  const INTERVIEW_STEPS = [
    {
      id: 1,
      aiText: "Why did you choose an asynchronous SQS queue between the API Gateway and Payment Service instead of making a direct HTTP REST call?",
      choices: [
        {
          text: "To decouple the API tier and absorb spikes in payment traffic during flash sales.",
          defenseDelta: "+12%",
          resilienceDelta: "+10%",
          nextStepId: 2
        },
        {
          text: "Because queues are faster than REST APIs in all scenarios.",
          defenseDelta: "-15%",
          resilienceDelta: "-5%",
          nextStepId: 2_bad
        }
      ]
    },
    {
      id: 2,
      aiText: "Fair point. Now what happens if the worker processing the payment queue crashes midway while communicating with Stripe? How do you prevent double-charging?",
      choices: [
        {
          text: "We send a deterministic Idempotency Key generated from (userId + cartHash) with every Stripe charge call.",
          defenseDelta: "+15%",
          resilienceDelta: "+18%",
          nextStepId: 3
        },
        {
          text: "We just wrap the worker function in a try/catch block.",
          defenseDelta: "-20%",
          resilienceDelta: "-15%",
          nextStepId: 3_bad
        }
      ]
    },
    {
      id: '2_bad',
      aiText: "Careful — latency overhead for queue serialization actually adds slight delay. The main benefit is decoupling. Now: how do you prevent duplicate charges if the worker times out?",
      choices: [
        {
          text: "Pass a deterministic Idempotency Key header on all Stripe API requests.",
          defenseDelta: "+10%",
          resilienceDelta: "+15%",
          nextStepId: 3
        }
      ]
    },
    {
      id: 3,
      aiText: "Excellent defense. Final test: If the queue backs up for 15 minutes due to a downstream Stripe outage, what UX fallback does your system present to the customer?",
      choices: [
        {
          text: "Return an HTTP 202 Accepted immediately with a polling status URL and webhook notification when processed.",
          defenseDelta: "+10%",
          resilienceDelta: "+12%",
          nextStepId: 4
        },
        {
          text: "Keep the browser tab hanging until the 15-minute queue clears.",
          defenseDelta: "-30%",
          resilienceDelta: "-25%",
          nextStepId: 4
        }
      ]
    },
    {
      id: 4,
      aiText: "🎉 Outstanding! You successfully defended your architectural choices like a Staff Infrastructure Engineer.",
      choices: []
    }
  ];

  let currentStepId = 1;
  let currentDefense = 75;
  let currentResilience = 70;

  const chatViewport = document.getElementById('chatViewport');
  const choicesList = document.getElementById('choicesList');
  const metricDefense = document.getElementById('metricDefense');
  const metricResilience = document.getElementById('metricResilience');
  const resetInterviewBtn = document.getElementById('resetInterviewBtn');
  const customAnswerInput = document.getElementById('customAnswerInput');
  const sendCustomAnswerBtn = document.getElementById('sendCustomAnswerBtn');

  function renderInterviewStep(stepId) {
    const step = INTERVIEW_STEPS.find(s => s.id === stepId) || INTERVIEW_STEPS[0];
    
    // Add AI Bubble
    const aiBubble = document.createElement('div');
    aiBubble.className = 'chat-bubble chat-ai';
    aiBubble.innerHTML = `
      <div class="ai-speaker">ALEX // STAFF INTERVIEWER</div>
      <div>${step.aiText}</div>
    `;
    chatViewport.appendChild(aiBubble);
    chatViewport.scrollTop = chatViewport.scrollHeight;

    // Render Choices
    choicesList.innerHTML = '';
    if (step.choices.length === 0) {
      const resetChoice = document.createElement('button');
      resetChoice.className = 'choice-btn';
      resetChoice.textContent = '🔄 Restart Mock Interview Simulator';
      resetChoice.onclick = resetInterview;
      choicesList.appendChild(resetChoice);
      return;
    }

    step.choices.forEach(choice => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.textContent = choice.text;
      btn.onclick = () => selectChoice(choice);
      choicesList.appendChild(btn);
    });
  }

  function selectChoice(choice) {
    // Add User Bubble
    const userBubble = document.createElement('div');
    userBubble.className = 'chat-bubble chat-user';
    userBubble.textContent = choice.text;
    chatViewport.appendChild(userBubble);

    // Update Metrics
    if (choice.defenseDelta.includes('+')) {
      currentDefense = Math.min(100, currentDefense + parseInt(choice.defenseDelta));
    } else {
      currentDefense = Math.max(10, currentDefense - parseInt(choice.defenseDelta.replace('-', '')));
    }

    if (choice.resilienceDelta.includes('+')) {
      currentResilience = Math.min(100, currentResilience + parseInt(choice.resilienceDelta));
    } else {
      currentResilience = Math.max(10, currentResilience - parseInt(choice.resilienceDelta.replace('-', '')));
    }

    metricDefense.textContent = `${currentDefense}%`;
    metricResilience.textContent = `${currentResilience}%`;

    // Advance to next step
    setTimeout(() => {
      renderInterviewStep(choice.nextStepId);
    }, 400);
  }

  function resetInterview() {
    chatViewport.innerHTML = '';
    currentStepId = 1;
    currentDefense = 75;
    currentResilience = 70;
    metricDefense.textContent = '75%';
    metricResilience.textContent = '70%';
    renderInterviewStep(1);
    showToast('Interview session reset');
  }

  sendCustomAnswerBtn.addEventListener('click', () => {
    const text = customAnswerInput.value.trim();
    if (!text) return;

    selectChoice({
      text: text,
      defenseDelta: '+5%',
      resilienceDelta: '+5%',
      nextStepId: 3
    });
    customAnswerInput.value = '';
  });

  resetInterviewBtn.addEventListener('click', resetInterview);

  /* Initial Interview Render */
  renderInterviewStep(1);


  /* ================= 3. BRIEF SPEC MODAL LOGIC ================= */
  const BRIEF_SPECS = {
    'brief-1': {
      tag: 'TICKET #104 // PRODUCTION BRIEF',
      title: 'High-Throughput Idempotent Payment Engine',
      content: `
        <h4>Overview</h4>
        <p>Design and implement an HTTP payment webhook ingestion service capable of processing 10,000 requests/sec with strict idempotency and zero duplicate charges.</p>
        <h4>Technical Requirements</h4>
        <ul>
          <li><strong>Idempotency Layer:</strong> Redis distributed lock using SHA-256 idempotency key hash with 24-hour TTL.</li>
          <li><strong>Database Resiliency:</strong> PostgreSQL transaction isolation level set to READ COMMITTED with retry backoff.</li>
          <li><strong>Dead Letter Queue (DLQ):</strong> Fallback SQS queue for unhandled gateway timeouts (>5000ms).</li>
        </ul>
        <h4>Evaluation Criteria</h4>
        <p>Staff engineers will evaluate your handling of network partitions, race conditions during high concurrency, and test coverage for gateway failures.</p>
      `
    },
    'brief-2': {
      tag: 'STAFF AUDIT SPEC // REFERENCE REPORT',
      title: 'Distributed Multi-Tenant Rate Limiter Audit',
      content: `
        <h4>Overview</h4>
        <p>Audit sample Rust/Go rate limiter implementations for multi-tenant SaaS platforms.</p>
        <h4>Key Vulnerability Audits</h4>
        <ul>
          <li><strong>TOCTOU Race Conditions:</strong> Flag non-atomic GET and SET calls on Redis counters.</li>
          <li><strong>Memory Leakage:</strong> Verify Redis key expiration logic to prevent infinite RAM growth.</li>
          <li><strong>Fail-Open vs Fail-Closed Strategy:</strong> Ensure Redis disconnects do not block legitimate API traffic.</li>
        </ul>
      `
    }
  };

  const briefModal = document.getElementById('briefModal');
  const modalTag = document.getElementById('modalTag');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const modalCloseBtn2 = document.getElementById('modalCloseBtn2');
  const openBriefBtns = document.querySelectorAll('.open-brief-btn');
  const viewSampleBriefFooter = document.getElementById('viewSampleBriefFooter');

  function openModal(briefId = 'brief-1') {
    const spec = BRIEF_SPECS[briefId] || BRIEF_SPECS['brief-1'];
    modalTag.textContent = spec.tag;
    modalTitle.textContent = spec.title;
    modalBody.innerHTML = spec.content;
    briefModal.classList.add('open');
    briefModal.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    briefModal.classList.remove('open');
    briefModal.setAttribute('aria-hidden', 'true');
  }

  openBriefBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const bId = btn.dataset.briefId || 'brief-1';
      openModal(bId);
    });
  });

  if (viewSampleBriefFooter) {
    viewSampleBriefFooter.addEventListener('click', (e) => {
      e.preventDefault();
      openModal('brief-1');
    });
  }

  closeModalBtn.addEventListener('click', closeModal);
  modalCloseBtn2.addEventListener('click', closeModal);
  briefModal.addEventListener('click', (e) => {
    if (e.target === briefModal) closeModal();
  });


  /* ================= 4. LEAD FORM & TOAST SYSTEM ================= */
  const signupForm = document.getElementById('signupForm');
  const emailInput = document.getElementById('emailInput');
  const toastContainer = document.getElementById('toastContainer');

  function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.textContent = msg;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  if (signupForm) {
    signupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      if (!email) return;

      showToast(`🎉 Access Granted! Audit brief instructions sent to ${email}`);
      openModal('brief-1');

      emailInput.value = '';
    });
  }


  /* ================= 5. MOBILE DRAWER NAVIGATION ================= */
  const mobileToggle = document.getElementById('mobileToggle');
  const mobileDrawer = document.getElementById('mobileDrawer');

  if (mobileToggle && mobileDrawer) {
    mobileToggle.addEventListener('click', () => {
      const isOpen = mobileDrawer.classList.toggle('open');
      mobileToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    mobileDrawer.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileDrawer.classList.remove('open');
        mobileToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

});
