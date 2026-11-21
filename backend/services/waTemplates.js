// The WhatsApp message templates this app sends. Each one must be created
// and approved on EVERY centre's WhatsApp Business Account (Meta Business
// Manager → WhatsApp Manager → Message templates) with exactly this name,
// category, language and variable order. The Super Admin panel lists them,
// and HANDOVER doc for Sant has the copy-paste text.
//
// Language: WA_TEMPLATE_LANG (default "en"). If a centre wants Hindi,
// create the same names in Hindi and set the language for that server.

export const TEMPLATES = {
  test_open: {
    name: 'wc_test_open',
    category: 'UTILITY',
    body: 'Hi {{1}}, a new test "{{2}}" is open at {{3}}. Start it here: {{4}}',
    example: ['Aman', 'Percentages exit ticket', 'Gill Academy', 'https://competitive.waynur.com/go/abc123'],
    sentTo: 'Students in the batch, when a teacher publishes an online test',
  },
  practice: {
    name: 'wc_practice',
    category: 'UTILITY',
    body: 'Hi {{1}}, your teacher at {{2}} has set practice questions on {{3}} for you. Practice here: {{4}}',
    example: ['Aman', 'Gill Academy', 'Time & Work', 'https://competitive.waynur.com/go/abc123'],
    sentTo: 'Each weak student, when the teacher creates the next-class plan',
  },
  result_parent: {
    name: 'wc_result_parent',
    category: 'UTILITY',
    body: 'Result from {{1}}: {{2}} scored {{3}} in "{{4}}". Topics to work on: {{5}}. Reply REPORT any time to see the latest results.',
    example: ['Gill Academy', 'Aman', '8 / 12', 'Percentages exit ticket', 'Time & Work'],
    sentTo: "The student's parent, when a test is submitted or paper marks are entered",
  },
  teacher_report: {
    name: 'wc_teacher_report',
    category: 'UTILITY',
    body: '{{1}}: "{{2}}" is ready. {{3}} students submitted. Re-teach next class: {{4}}. Reply REPORT {{5}} for details.',
    example: ['Gill Academy', 'Percentages exit ticket', '28 of 30', 'Time & Work (41%)', '12'],
    sentTo: 'The teacher who made the test, when the next-class plan is created',
  },
  otp: {
    name: 'wc_login_otp',
    category: 'AUTHENTICATION',
    body: '{{1}} is your verification code. (Meta writes this text itself; pick "Copy code" button.)',
    example: ['482913'],
    sentTo: 'A student who logs in with "Get code on WhatsApp"',
  },
};

export const templateLang = () => process.env.WA_TEMPLATE_LANG || 'en';
