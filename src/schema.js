// Declarative definition of the 9 onboarding sections. The same schema drives
// the applicant wizard, server-side validation, the admin review screen and the PDF report.
const { company, screening } = require('./config');
const { COUNTRY_OPTIONS } = require('./countries');

// UK numbers (07700 900123, 020 7946 0000, +44 7700 900123, +44 (0)20…) or any international
// number written with its country code (+33 6 12 34 56 78, 0092 300 1234567).
function validPhone(v) {
  const s = String(v).replace(/[\s().-]/g, '');
  const uk = s.replace(/^(\+|00)440?/, '0');
  if (uk !== s || s.startsWith('0') && !s.startsWith('00')) {
    // UK: mobiles (07…) are always 11 digits; some landlines are 10.
    return uk.startsWith('07') ? /^07\d{9}$/.test(uk) : /^0[1-9]\d{8,9}$/.test(uk);
  }
  return /^(\+|00)[1-9]\d{6,14}$/.test(s);
}

const YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
const PNTS = { value: 'prefer_not', label: 'Prefer not to say' };
const opts = (...labels) => labels.map((l) => (typeof l === 'string' ? { value: l.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), label: l } : l));

const PATTERNS = {
  // Enforced only when the address country is the United Kingdom (see validateSection).
  postcode: { re: /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i, msg: 'Enter a valid UK postcode, e.g. RM13 8UH' },
  ni: { re: /^(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]$/i, msg: 'Enter a valid National Insurance number, e.g. AB 12 34 56 C' },
  sortcode: { re: /^\d{2}-?\d{2}-?\d{2}$/, msg: 'Enter a 6-digit sort code, e.g. 12-34-56' },
  account: { re: /^\d{8}$/, msg: 'Enter an 8-digit account number' },
  sia: { re: /^\d{4} ?\d{4} ?\d{4} ?\d{4}$/, msg: 'SIA licence numbers are 16 digits' },
  sharecode: { re: /^[A-Z0-9]{3} ?[A-Z0-9]{3} ?[A-Z0-9]{3}$/i, msg: 'Share codes are 9 characters, e.g. W4A B7C 9D2' },
  phone: { re: { test: validPhone }, msg: 'Enter a UK number (e.g. 07700 900123) or an international number with its country code (e.g. +33 6 12 34 56 78)' },
  email: { re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, msg: 'Enter a valid email address' },
};

const SCREENING_NOTES = `
<p><strong>Introduction.</strong> As you may be aware, we carry out security screening to ensure that you are not a present or potential future security risk. The British Standard with which we must comply is <strong>BS 7858:2019</strong> – <em>Screening of individuals working in a secure environment</em>.</p>
<p>Under BS 7858 you are required to provide evidence of previous employers, periods of self-employment, unemployment, full-time education, time spent abroad and any periods spent in prison. The purpose is to verify your whereabouts on a month-by-month basis for the last <strong>${screening.periodYears} years</strong>. We must also verify your name and address and take up references. Screening must be completed within <strong>${screening.completionWeeks} weeks</strong>.</p>
<ul class="notes-list">
<li><strong>Names and addresses</strong> – provide full, accurate names, postcodes and telephone numbers (with area codes). Ensure surnames are spelled correctly.</li>
<li><strong>Previous employers</strong> – state your immediate superior, job title and reason for leaving. Record month and year for start and end. A reference will be requested from your most recent employer.</li>
<li><strong>No longer trading</strong> – give as much detail as possible. If you are still in touch with someone from that period, give their details as an additional reference.</li>
<li><strong>Self-employment</strong> – give details of your professional advisers (accountant, solicitor or bank) for that period.</li>
<li><strong>Unemployment</strong> – give details of the office at which you claimed benefit or signed on.</li>
<li><strong>Full-time education</strong> – give accurate start and finish dates (month and year).</li>
<li><strong>Periods abroad</strong> – provide evidence such as visa, passport stamps, hotel bills, wage slips or statements.</li>
<li><strong>Periods in prison</strong> – exact dates on a month-by-month basis, prison address and reference number. Attach any Certificate of Discharge.</li>
</ul>
<p>If there is information you do not have yet, you can save your progress and return later – but please tell us when we can expect it.</p>`;

const LETTER_OF_AUTHORITY = `
<ol class="loa">
<li>I understand that employment with the Company is subject to satisfactory references and security screening in accordance with BS 7858.</li>
<li>I undertake to cooperate with the Company in providing any additional information required to meet these criteria.</li>
<li>I authorise the Company and/or its nominated agent to approach previous employers, schools/colleges, character references or Government agencies to verify that the information I have provided is correct.</li>
<li>I authorise the Company to make a consumer information search with a credit reference agency, which will keep a record of that search and may share that information with other credit reference agencies.</li>
<li>I understand that some of the information I have provided in this application will be held on a computer and some or all will be held on manual records.</li>
<li>I consent to the Company's reasonable processing of any sensitive personal information obtained for the purposes of establishing any medical condition and future fitness to perform my duties. I accept that I may be required to undergo a medical examination where requested by the Company. Subject to the Access to Medical Reports Act 1988, I consent to the results of such examinations being given to the Company. I understand and agree that, if so required, I will make a Statutory Declaration in accordance with the Statutory Declarations Act 1835, in confirmation of previous employment or unemployment.</li>
<li>I certify that, to the best of my knowledge, the details I have given in this application are complete and correct.</li>
<li>I understand that any false statement or omission to the Company or its representatives may render me liable to dismissal without notice.</li>
</ol>`;

const PRIVACY_NOTICE = `
<p>We process personal data relating to those who apply for vacancies with us. We do this for employment purposes, to assist in the selection of candidates, to meet our obligations under BS 7858 and to assist in running the business. The data may include identifiers such as name and date of birth, personal characteristics such as gender, qualifications and employment history.</p>
<p>We will not share identifiable information with third parties without your consent unless the law allows or requires us to do so. Data provided during an application will be retained for at least six months or, if required by law or BS 7858, for as long as required (screening records are retained for the duration of employment plus a minimum of 7 years).</p>
<p>This notice does not form part of any offer or contract. To see the information we hold about you, or for any data-protection query, email <strong>${company.email}</strong> with the subject "Data Protection Request".</p>`;

const HISTORY_TYPES = opts('Employment', 'Self-employment', 'Unemployment', 'Full-time education', 'Time abroad', 'Career break / other', 'Custodial sentence');

const sections = [
  {
    key: 'process',
    num: 1,
    title: 'Understanding the process',
    short: 'Screening process',
    icon: 'info',
    intro: 'Please read how BS 7858 security screening works, then sign the Letter of Authority so we can take up your references.',
    fields: [
      { type: 'info', key: 'notes_block', title: 'Your security screening', html: SCREENING_NOTES },
      { type: 'confirm', key: 'read_notes', label: 'I have read and understood the screening notes above.', required: true },
      { type: 'info', key: 'loa_block', title: 'Letter of Authority', html: LETTER_OF_AUTHORITY },
      { ac: 'name', type: 'text', key: 'print_name', label: 'Print full name', required: true, width: 'half', prefill: 'fullname' },
      { type: 'signature', key: 'loa_signature', label: 'Signature – Letter of Authority', required: true },
    ],
  },
  {
    key: 'application',
    num: 2,
    title: 'Application for employment',
    short: 'Application',
    icon: 'user',
    intro: 'All information is treated as strictly confidential and no approach will be made to any person without your permission.',
    fields: [
      { type: 'heading', title: 'Position' },
      { type: 'text', key: 'position', label: 'Position applied for', required: true, width: 'half', placeholder: 'e.g. Security Officer' },
      { type: 'select', key: 'employment_type', label: 'Employment type', width: 'half', options: opts('Full-time', 'Part-time', 'Zero hours / relief'), required: true },
      { type: 'yesno', key: 'other_employment', label: 'If you obtained this position, would you continue in any other employment?', required: true },
      { type: 'textarea', key: 'other_employment_details', label: 'Please give details of the other employment', showIf: { key: 'other_employment', eq: 'yes' }, required: true },
      { type: 'yesno', key: 'adjustments', label: 'Do we need to make any disability-related adjustments to allow you to take part in the recruitment process?', required: true },
      { type: 'textarea', key: 'adjustments_details', label: 'Please describe the adjustments needed', showIf: { key: 'adjustments', eq: 'yes' }, required: true },
      { type: 'yesno', key: 'right_to_work', label: 'Are you entitled to enter or remain in the UK and undertake the work in question?', required: true },

      { type: 'heading', title: 'Personal details' },
      { ac: 'honorific-prefix', type: 'select', key: 'title', label: 'Title', width: 'quarter', required: true, options: opts('Mr', 'Mrs', 'Miss', 'Ms', 'Mx', 'Dr') },
      { ac: 'given-name', type: 'text', key: 'forenames', label: 'Forename(s)', width: 'threeq', required: true, help: 'Full forenames as on your passport – no initials or shortened names.', prefill: 'first_name' },
      { ac: 'family-name', type: 'text', key: 'surname', label: 'Surname', width: 'half', required: true, prefill: 'last_name' },
      { type: 'text', key: 'previous_names', label: 'Any previous names (maiden name, aliases)', width: 'half', help: 'Leave blank if none.' },
      { ac: 'bday', type: 'date', key: 'dob', label: 'Date of birth', width: 'half', required: true },
      { type: 'text', key: 'nationality', label: 'Nationality', width: 'half', required: true },
      { ac: 'country', type: 'select', key: 'country', label: 'Country of residence', width: 'half', required: true, options: COUNTRY_OPTIONS, default: 'GB' },
      { ac: 'street-address', type: 'textarea', key: 'address', label: 'Home address', required: true, rows: 3 },
      { ac: 'postal-code', type: 'text', key: 'postcode', label: 'Postcode / ZIP code', width: 'half', required: true, pattern: 'postcode', upper: true, help: 'UK addresses need a valid UK postcode. Leave blank if your country has none.' },
      { type: 'month', key: 'address_since', label: 'Living at this address since', width: 'half', required: true },
      { type: 'repeater', key: 'previous_addresses', label: 'Previous addresses (last 5 years)', addLabel: 'Add previous address', help: 'Required for identity and consumer-information checks if you have lived at your current address for less than 5 years. Include any addresses outside the UK.',
        fields: [
          { type: 'select', key: 'country', label: 'Country', width: 'half', required: true, options: COUNTRY_OPTIONS, default: 'GB' },
          { type: 'textarea', key: 'address', label: 'Address', rows: 2, required: true },
          { type: 'text', key: 'postcode', label: 'Postcode / ZIP code', width: 'half', required: true, pattern: 'postcode', upper: true },
          { type: 'month', key: 'from', label: 'From', width: 'half', required: true },
          { type: 'month', key: 'to', label: 'To', width: 'half', required: true },
        ] },
      { ac: 'tel', type: 'tel', key: 'mobile', label: 'Mobile telephone', width: 'half', required: true, pattern: 'phone', prefill: 'phone' },
      { ac: 'tel', type: 'tel', key: 'home_phone', label: 'Home telephone', width: 'half', pattern: 'phone' },
      { ac: 'email', type: 'email', key: 'email', label: 'Email', width: 'half', required: true, pattern: 'email', prefill: 'email' },

      { type: 'heading', title: 'Emergency contact' },
      { type: 'text', key: 'nok_name', label: 'Name', width: 'third', required: true },
      { type: 'text', key: 'nok_relationship', label: 'Relationship', width: 'third', required: true },
      { type: 'tel', key: 'nok_phone', label: 'Telephone', width: 'third', required: true, pattern: 'phone', help: 'Include the country code if outside the UK.' },
      { type: 'select', key: 'nok_country', label: 'Country', width: 'half', options: COUNTRY_OPTIONS, default: 'GB' },
      { type: 'textarea', key: 'nok_address', label: 'Address (optional)', rows: 2 },

      { type: 'heading', title: 'Education and training' },
      { type: 'repeater', key: 'education', label: 'Schools, colleges, universities and training', addLabel: 'Add education / training', min: 1,
        fields: [
          { type: 'text', key: 'establishment', label: 'School / college / etc.', required: true },
          { type: 'month', key: 'from', label: 'From', width: 'half', required: true },
          { type: 'month', key: 'to', label: 'To', width: 'half', required: true },
          { type: 'textarea', key: 'qualifications', label: 'Qualifications', rows: 2 },
        ] },

      { type: 'heading', title: `Employment and activity history (last ${screening.periodYears} years)`, help: `BS 7858 requires a continuous, month-by-month account of the last ${screening.periodYears} years. Include employment, self-employment, unemployment, education, time abroad and any other periods. Gaps of ${screening.gapDays} days or more must be accounted for. Start with your current or most recent activity.` },
      { type: 'timeline', key: 'history_timeline' },
      { type: 'repeater', key: 'history', label: 'Activity history', addLabel: 'Add another period', min: 1, history: true,
        fields: [
          { type: 'select', key: 'type', label: 'Type of activity', required: true, options: HISTORY_TYPES },
          { type: 'month', key: 'from', label: 'From (month/year)', width: 'half', required: true },
          { type: 'month', key: 'to', label: 'To (month/year)', width: 'half', required: true, showIf: { key: 'current', ne: 'yes' } },
          { type: 'confirm', key: 'current', label: 'This is my current activity', compact: true },
          { type: 'text', key: 'org_name', label: 'Employer / organisation / establishment name', required: true, showIf: { key: 'type', in: ['employment', 'self_employment', 'full_time_education'] } },
          { type: 'textarea', key: 'org_address', label: 'Full address', rows: 2, required: true, showIf: { key: 'type', in: ['employment', 'self_employment', 'full_time_education', 'custodial_sentence'] } },
          { type: 'text', key: 'job_title', label: 'Job title or duties', width: 'half', required: true, showIf: { key: 'type', in: ['employment', 'self_employment'] } },
          { type: 'text', key: 'reason_leaving', label: 'Reason for leaving', width: 'half', showIf: { key: 'type', in: ['employment', 'self_employment', 'full_time_education'] } },
          { type: 'text', key: 'contact_name', label: 'Contact / immediate superior / adviser name', width: 'half', required: true, showIf: { key: 'type', in: ['employment', 'self_employment', 'full_time_education', 'unemployment'] }, help: 'Self-employed: your accountant, solicitor or bank. Unemployed: the Jobcentre office / adviser.' },
          { type: 'tel', key: 'contact_phone', label: 'Contact telephone', width: 'half', pattern: 'phone', showIf: { key: 'type', in: ['employment', 'self_employment', 'full_time_education', 'unemployment'] } },
          { type: 'email', key: 'contact_email', label: 'Contact email address', width: 'half', pattern: 'email', showIf: { key: 'type', in: ['employment', 'self_employment', 'full_time_education', 'unemployment'] }, help: 'Used to send the verification request.' },
          { type: 'yesno', key: 'may_contact', label: 'May we contact them now?', width: 'half', showIf: { key: 'type', in: ['employment', 'self_employment', 'full_time_education', 'unemployment'] } },
          { type: 'text', key: 'jobcentre', label: 'Jobcentre / benefit office where you signed on', showIf: { key: 'type', eq: 'unemployment' } },
          { type: 'text', key: 'country', label: 'Country / countries', width: 'half', required: true, showIf: { key: 'type', eq: 'time_abroad' } },
          { type: 'text', key: 'prison_ref', label: 'Prison reference number', width: 'half', showIf: { key: 'type', eq: 'custodial_sentence' } },
          { type: 'textarea', key: 'details', label: 'Details / explanation', rows: 2, showIf: { key: 'type', in: ['time_abroad', 'career_break_other', 'custodial_sentence', 'unemployment'] }, required: true },
          { type: 'files', key: 'evidence', label: 'Supporting evidence (optional)', help: 'e.g. P45, payslip, certificate, visa, letter of discharge.' },
        ] },

      { type: 'heading', title: 'Experience and other details' },
      { type: 'textarea', key: 'security_experience', label: 'Previous relevant experience in a security role', rows: 4 },
      { type: 'textarea', key: 'interests', label: 'Interests', rows: 2 },
      { type: 'textarea', key: 'convictions', label: 'List any criminal convictions other than "spent" or "filtered" convictions. If none, state "None".', rows: 2, required: true, help: 'The information provided will be confidential and considered only in relation to this application.' },

      { type: 'heading', title: 'References' },
      { type: 'confirm', key: 'reference_consent', label: 'I authorise you to contact the references below to obtain any information which, in your opinion, will attest to my suitability, qualifications and work history.', required: true },
      { type: 'repeater', key: 'references', label: 'Work references', min: 2, max: 3, addLabel: 'Add another reference', fixedLabels: ['Work reference 1', 'Work reference 2', 'Additional reference'],
        fields: [
          { type: 'text', key: 'name', label: 'Name', width: 'half', required: true },
          { type: 'text', key: 'company', label: 'Company / relationship to you', width: 'half', required: true },
          { type: 'select', key: 'country', label: 'Country', width: 'half', options: COUNTRY_OPTIONS, default: 'GB' },
          { type: 'textarea', key: 'address', label: 'Address', rows: 2 },
          { type: 'text', key: 'postcode', label: 'Postcode / ZIP code', width: 'third', pattern: 'postcode', upper: true },
          { type: 'tel', key: 'phone', label: 'Telephone', width: 'third', required: true, pattern: 'phone' },
          { type: 'email', key: 'email', label: 'Email address', width: 'third', required: true, pattern: 'email' },
        ] },

      { type: 'heading', title: 'Privacy notice' },
      { type: 'info', key: 'privacy_block', html: PRIVACY_NOTICE },
      { type: 'confirm', key: 'privacy_ack', label: 'I have read the privacy notice.', required: true },

      { type: 'heading', title: 'Application declaration' },
      { type: 'info', key: 'decl_text', html: '<p>The information I have provided is true. I understand that any job offer made on the basis of untrue or misleading information may be withdrawn or my employment terminated.</p>' },
      { type: 'signature', key: 'declaration_signature', label: 'Signed', required: true },
    ],
    validate(data, errors) {
      const { historyGaps } = require('./timeline');
      const res = historyGaps(data.history || []);
      if (res.errors.length) errors._history = res.errors.join(' ');
    },
  },
  {
    key: 'documents',
    num: 3,
    title: 'ID verification checks',
    short: 'Documents & ID',
    icon: 'id',
    intro: 'Please enter your document details and attach a clear photo or scan of each document. Photos taken on your phone are fine – make sure all four corners are visible and text is readable.',
    fields: [
      { type: 'heading', title: 'SIA licence' },
      { type: 'text', key: 'sia_number', label: 'SIA badge number', width: 'half', pattern: 'sia', help: '16-digit number on the front of your licence.' },
      { type: 'date', key: 'sia_expiry', label: 'SIA badge expiry date', width: 'quarter' },
      { type: 'select', key: 'sia_type', label: 'SIA badge type', width: 'quarter', options: opts('Security Guarding', 'Door Supervision', 'Close Protection', 'CCTV (Public Space Surveillance)', 'Cash and Valuables in Transit', 'Key Holding', 'Vehicle Immobilising', 'Not yet licensed / applied') },
      { type: 'select', key: 'sia_licence_class', label: 'Licence class', width: 'half', options: opts('Front line', 'Non-front line') },
      { type: 'files', key: 'sia_files', label: 'SIA licence – front and back', accept: 'image' },

      { type: 'heading', title: 'Passport / photo identity' },
      { type: 'text', key: 'passport_number', label: 'Passport number', width: 'half', upper: true },
      { type: 'date', key: 'passport_expiry', label: 'Passport expiry date', width: 'quarter' },
      { type: 'text', key: 'passport_country', label: 'Issuing country', width: 'quarter' },
      { type: 'files', key: 'passport_files', label: 'Passport photo page', accept: 'image' },
      { type: 'text', key: 'driving_licence', label: 'Driving licence number (if held)', width: 'half', upper: true },
      { type: 'files', key: 'driving_licence_files', label: 'Driving licence – front and back' },
      { type: 'files', key: 'photo_files', label: 'Recent passport-style photograph of yourself', accept: 'image' },

      { type: 'heading', title: 'National Insurance' },
      { type: 'text', key: 'ni_number', label: 'National Insurance number', width: 'half', required: true, pattern: 'ni', upper: true },
      { type: 'files', key: 'ni_files', label: 'NI evidence (letter, P60, payslip)', help: 'Optional' },

      { type: 'heading', title: 'Proof of address', help: 'Two documents required. Bank statements and utility bills must be dated within the last 3 months; council tax bills and driving licences must be from the current year.' },
      { type: 'select', key: 'poa_1_type', label: 'Proof of address document 1', width: 'half', required: true, options: opts('Bank statement (last 3 months)', 'Utility bill (last 3 months)', 'Council tax bill (current year)', 'Driving licence (current)', 'HMRC / DWP letter (current year)', 'Mortgage / tenancy agreement') },
      { type: 'date', key: 'poa_1_date', label: 'Document 1 date', width: 'half', required: true },
      { type: 'files', key: 'poa_1_files', label: 'Upload document 1', required: true },
      { type: 'select', key: 'poa_2_type', label: 'Proof of address document 2', width: 'half', required: true, options: opts('Bank statement (last 3 months)', 'Utility bill (last 3 months)', 'Council tax bill (current year)', 'Driving licence (current)', 'HMRC / DWP letter (current year)', 'Mortgage / tenancy agreement') },
      { type: 'date', key: 'poa_2_date', label: 'Document 2 date', width: 'half', required: true },
      { type: 'files', key: 'poa_2_files', label: 'Upload document 2', required: true },

      { type: 'heading', title: 'Criminal record (DBS)' },
      { type: 'text', key: 'dbs_number', label: 'DBS certificate number', width: 'half', help: '12 digits, top right of your certificate.' },
      { type: 'yesno', key: 'dbs_update_service', label: 'Is your certificate registered with the DBS Update Service?', width: 'half' },
      { type: 'files', key: 'dbs_files', label: 'DBS certificate' },

      { type: 'heading', title: 'Right to work' },
      { type: 'select', key: 'rtw_route', label: 'How will you prove your right to work?', required: true, options: opts('British / Irish passport', 'Share code (eVisa / BRP / EU Settlement Scheme)', 'Birth certificate + NI evidence', 'Other document') },
      { type: 'text', key: 'rtw_share_code', label: 'Right to work share code', width: 'half', pattern: 'sharecode', upper: true, required: true, showIf: { key: 'rtw_route', eq: 'share_code_evisa_brp_eu_settlement_scheme' }, help: 'Get this from gov.uk/prove-right-to-work' },
      { type: 'text', key: 'work_permit', label: 'Work permit / visa type and expiry', width: 'half', showIf: { key: 'rtw_route', in: ['share_code_evisa_brp_eu_settlement_scheme', 'other_document'] } },
      { type: 'files', key: 'rtw_files', label: 'Right to work evidence', help: 'Share code result, visa, BRP or birth certificate.' },

      { type: 'heading', title: 'Students' },
      { type: 'yesno', key: 'is_student', label: 'Are you currently a student?', width: 'half' },
      { type: 'textarea', key: 'term_timetable', label: 'Term timetable / term dates', rows: 2, showIf: { key: 'is_student', eq: 'yes' } },
      { type: 'files', key: 'term_files', label: 'Term timetable (attachment)', showIf: { key: 'is_student', eq: 'yes' } },

      { type: 'heading', title: 'Other attachments' },
      { type: 'files', key: 'other_files', label: 'Any other ID document images / attachments' },
    ],
  },
  {
    key: 'declaration',
    num: 4,
    title: 'Declaration form',
    short: 'Declaration',
    icon: 'pen',
    intro: 'Personal reference and employment verification declaration.',
    fields: [
      { type: 'yesno', key: 'court_orders', label: 'Have you ever been fined, sentenced to imprisonment, placed on probation, discharged on payment of costs, or had any other order made against you by a criminal, civil or military court or public authority, or is any action pending? This includes bankruptcy proceedings, IVAs or County Court Judgments for debt.', required: true },
      { type: 'textarea', key: 'court_details', label: 'Please give full details', required: true, showIf: { key: 'court_orders', eq: 'yes' } },
      { type: 'heading', title: 'Declaration 1' },
      { type: 'radio', key: 'filled_by', label: 'Who completed this form?', required: true, options: [{ value: 'self', label: 'I filled out this form myself' }, { value: 'other', label: 'This form was filled out on my behalf' }] },
      { type: 'text', key: 'filled_by_name', label: 'Name of the person who completed it', required: true, showIf: { key: 'filled_by', eq: 'other' } },
      { type: 'signature', key: 'decl1_signature', label: 'Signed – Declaration 1', required: true },
      { type: 'heading', title: 'Declaration 2' },
      { type: 'info', key: 'd2', html: '<p>I declare that the particulars given in this form are true and accurate to the best of my knowledge. I acknowledge that misrepresenting the facts on this form constitutes grounds for immediate dismissal.</p>' },
      { type: 'signature', key: 'decl2_signature', label: 'Signed – Declaration 2', required: true },
      { type: 'heading', title: 'Declaration 3' },
      { type: 'info', key: 'd3', html: `<p>I authorise ${company.name} to approach former employers, schools, colleges, the Police and any government agencies for the purpose of verifying the information that I have supplied in this Application for Employment. I am prepared to sign a Statutory Declaration if required to do so.</p>` },
      { type: 'signature', key: 'decl3_signature', label: 'Signed – Declaration 3', required: true },
      { type: 'heading', title: 'Current employer' },
      { type: 'yesno', key: 'approach_current', label: 'May we approach your current employer for security screening purposes?', required: true },
    ],
  },
  {
    key: 'diversity',
    num: 5,
    title: 'Diversity monitoring',
    short: 'Diversity',
    icon: 'people',
    confidential: true,
    intro: `${company.name} is committed to ensuring that everyone who applies to work for us receives fair treatment regardless of age, disability, race, sex, gender reassignment, sexual orientation, religion or belief, marriage and civil partnership. This information is held separately from your application, is used only for statistical monitoring, and every question has a "Prefer not to say" option.`,
    fields: [
      { type: 'text', key: 'advertised', label: 'Where did you see this post advertised?', width: 'half' },
      { type: 'radio', key: 'gender', label: 'Gender', inline: true, options: [...opts('Male', 'Female', 'Non-binary', 'Other'), PNTS] },
      { type: 'radio', key: 'gender_same', label: 'Is your gender identity the same as the sex you were registered at birth?', inline: true, options: [...YES_NO, PNTS] },
      { type: 'radio', key: 'marital', label: 'Marital status', inline: true, options: [...opts('Single', 'Married', 'Civil partnership', 'Partner', 'Separated', 'Divorced', 'Widowed'), PNTS] },
      { type: 'radio', key: 'age_band', label: 'Age band', inline: true, options: [...opts('16-24', '25-34', '35-44', '45-54', '55-64', '65+'), PNTS] },
      { type: 'radio', key: 'ethnicity', label: 'Ethnicity', inline: true, options: [...opts('White', 'Mixed / multiple ethnic groups', 'Asian / Asian British', 'Black / African / Caribbean / Black British', 'Chinese', 'Other ethnic group'), PNTS] },
      { type: 'text', key: 'ethnicity_other', label: 'Please specify', width: 'half', showIf: { key: 'ethnicity', eq: 'other_ethnic_group' } },
      { type: 'radio', key: 'orientation', label: 'Sexual orientation', inline: true, options: [...opts('Heterosexual', 'Gay woman / lesbian', 'Gay man', 'Bisexual', 'Other'), PNTS] },
      { type: 'radio', key: 'faith', label: 'Religion or belief', inline: true, options: [...opts('No religion', 'Buddhist', 'Christian', 'Hindu', 'Jewish', 'Muslim', 'Sikh', 'Other'), PNTS] },
      { type: 'text', key: 'faith_other', label: 'Please specify', width: 'half', showIf: { key: 'faith', eq: 'other' } },
      { type: 'radio', key: 'disability', label: 'Do you have a disability or medical condition that we may need to be aware of?', inline: true, options: [...YES_NO, PNTS] },
      { type: 'textarea', key: 'disability_details', label: 'Please specify', rows: 2, showIf: { key: 'disability', eq: 'yes' } },
      { type: 'confirm', key: 'dp_ack', label: 'I understand and agree to the data-protection statement above.', required: true },
      { type: 'signature', key: 'signature', label: 'Signed', required: true },
    ],
  },
  {
    key: 'health',
    num: 6,
    title: 'Health screening questionnaire',
    short: 'Health',
    icon: 'heart',
    confidential: true,
    intro: 'This information is collected under our duty of care to ensure it is safe for you to undertake your work and that the work will not worsen any existing condition. It is handled in strict confidence. Detailed clinical information will not be revealed without your consent.',
    fields: [
      { type: 'heading', title: 'Section B – The job involves / may expose you to', help: 'The role you are applying for involves the items ticked below.' },
      { type: 'checkboxes', key: 'job_hazards', label: 'Job hazards', readonly: true, columns: 2,
        default: ['lone_working', 'night_shifts', '12_hour_shift_periods', 'standing_for_long_periods', 'regular_vehicle_driving_activities'],
        options: opts('Electromagnetic fields (EMF)', 'Regular manual handling / lifting duties', 'Lone working', 'Night shifts', 'Hazardous substances', '12 hour shift periods', 'Human blood, tissues, fluids or biological agents', 'Regular vehicle driving activities', 'Standing for long periods', 'Respiratory sensitisers or allergens', 'Latex materials', 'Vibrating equipment', 'Noisy environments', 'Working at height', 'Regular display screen equipment (DSE) usage') },
      { type: 'heading', title: 'Section C – Health history' },
      { type: 'checkboxes', key: 'conditions', label: 'Do you have, or have you previously had, any of the following? Tick all that apply.', columns: 2,
        options: opts('Giddiness, fainting attacks, epilepsy', 'Stroke, heart trouble, high blood pressure or varicose veins', 'Mental illness, anxiety or depression', 'Diabetes', 'Recurring headaches', 'Skin trouble', 'Serious injury or operations', 'Ear trouble or deafness', 'Serious hay fever, asthma or recurring chest infections', 'Colour vision or eye trouble not corrected by glasses / lenses', 'Recurring stomach or bowel trouble', 'Back or muscle / joint trouble', 'Recurring bladder trouble', 'Hernia or rupture') },
      { type: 'yesno', key: 'implants', label: 'Do you have any implanted, body-active or inactive medical devices (e.g. pacemaker)?', required: true },
      { type: 'yesno', key: 'other_conditions', label: 'Do you have any other known medical conditions not mentioned above?', required: true },
      { type: 'number', key: 'absence_days', label: 'How many days have you been absent from work in the last three years because of illness or injury?', width: 'half', min: 0, required: true },
      { type: 'yesno', key: 'medication', label: 'Are you currently taking any prescribed medication?', required: true },
      { type: 'yesno', key: 'allergies', label: 'Are you allergic to any medications (e.g. penicillin)?', required: true },
      { type: 'text', key: 'allergies_which', label: 'Please state which', showIf: { key: 'allergies', eq: 'yes' }, required: true },
      { type: 'textarea', key: 'health_notes', label: 'Notes – please give details of anything ticked or answered "Yes" above', rows: 3, help: 'If you answer "Yes", you may be asked to see a doctor or nurse for further assessment.' },
      { type: 'heading', title: 'Section D – Disabilities' },
      { type: 'yesno', key: 'disability_affects', label: 'Do you have any disabilities that affect: standing, walking, climbing stairs, lifting, using your hands, driving a vehicle, working at heights, climbing ladders or working on staging?', required: true },
      { type: 'textarea', key: 'disability_affects_details', label: 'Please give details', rows: 2, showIf: { key: 'disability_affects', eq: 'yes' }, required: true },
      { type: 'heading', title: 'Section E – Declaration' },
      { type: 'info', key: 'he', html: '<p>I confirm that, to the best of my knowledge and belief, the above information is correct. I understand that any failure to disclose information could lead to a re-assessment of my general fitness, which could ultimately lead to the termination of my employment.</p>' },
      { ac: 'name', type: 'text', key: 'name_caps', label: 'Name (BLOCK CAPITALS)', width: 'half', required: true, upper: true, prefill: 'fullname' },
      { type: 'signature', key: 'signature', label: 'Signature', required: true },
    ],
  },
  {
    key: 'optout',
    num: 7,
    title: '48-hour working week opt-out',
    short: '48hr opt-out',
    icon: 'clock',
    intro: 'The Working Time Regulations 1998 provide that the average working week, including overtime, shall not exceed 48 hours. Signing this agreement is voluntary – you cannot be treated unfairly for choosing not to opt out.',
    fields: [
      { type: 'info', key: 'agreement', title: `Individual agreement between ${company.name} (Employer) and the Employee`, html: `
        <ol>
          <li>The employer and the employee agree that the 48-hour average weekly limit shall not apply to the employee.</li>
          <li>This agreement will remain in force indefinitely.</li>
          <li>The employer or the employee may terminate this agreement at any time by giving not less than three months' written notice to the other.</li>
        </ol>` },
      { type: 'radio', key: 'opt_out', label: 'Your choice', required: true, options: [{ value: 'yes', label: 'I agree to opt out of the 48-hour maximum average working week' }, { value: 'no', label: 'I do not wish to opt out' }] },
      { ac: 'name', type: 'text', key: 'employee_name', label: 'Employee full name', width: 'half', required: true, prefill: 'fullname' },
      { type: 'signature', key: 'signature', label: 'Employee signature', required: true },
    ],
  },
  {
    key: 'hmrc',
    num: 8,
    title: 'HMRC starter checklist or P45',
    short: 'HMRC / P45',
    icon: 'doc',
    intro: 'We need this information before your first payday to tell HMRC about you and help them use the correct tax code. If you have a P45 from your last employer, upload it and still complete the statement below.',
    fields: [
      { type: 'yesno', key: 'has_p45', label: 'Do you have a P45 from your previous employer (this tax year)?', required: true },
      { type: 'files', key: 'p45_files', label: 'Upload your P45 (parts 2 and 3)', required: true, showIf: { key: 'has_p45', eq: 'yes' } },
      { type: 'heading', title: 'Employee\'s personal details' },
      { ac: 'family-name', type: 'text', key: 'last_name', label: '1. Last name', width: 'half', required: true, prefill: 'last_name' },
      { ac: 'given-name', type: 'text', key: 'first_names', label: '2. First name(s)', width: 'half', required: true, prefill: 'first_name', help: 'Do not enter initials or shortened names such as Jim for James.' },
      { type: 'radio', key: 'sex', label: '3. Are you male or female? (as recorded by HMRC)', inline: true, required: true, options: opts('Male', 'Female') },
      { ac: 'bday', type: 'date', key: 'dob', label: '4. Date of birth', width: 'half', required: true, prefill: 'application.dob' },
      { ac: 'street-address', type: 'textarea', key: 'address', label: '5. Home address', rows: 3, required: true, prefill: 'application.address' },
      { ac: 'postal-code', type: 'text', key: 'postcode', label: 'Postcode / ZIP code', width: 'half', required: true, pattern: 'postcode', upper: true, prefill: 'application.postcode' },
      { ac: 'country', type: 'select', key: 'country', label: 'Country', width: 'half', required: true, options: COUNTRY_OPTIONS, prefill: 'application.country' },
      { type: 'text', key: 'ni', label: '6. National Insurance number (if known)', width: 'half', pattern: 'ni', upper: true, prefill: 'documents.ni_number' },
      { type: 'date', key: 'start_date', label: '7. Employment start date', width: 'half', help: 'Leave blank if not yet confirmed.' },
      { type: 'heading', title: '8. Employee statement', help: 'Select only one of the following statements A, B or C.' },
      { type: 'radio', key: 'statement', label: 'Statement', required: true, options: [
        { value: 'A', label: 'A – This is my first job since last 6 April and I have not been receiving taxable Jobseeker\'s Allowance, Employment and Support Allowance, taxable Incapacity Benefit, State or Occupational Pension.' },
        { value: 'B', label: 'B – This is now my only job but since last 6 April I have had another job, or received taxable Jobseeker\'s Allowance, Employment and Support Allowance or taxable Incapacity Benefit. I do not receive a State or Occupational Pension.' },
        { value: 'C', label: 'C – As well as my new job, I have another job or receive a State or Occupational Pension.' },
      ] },
      { type: 'heading', title: 'Student loans' },
      { type: 'yesno', key: 'student_loan', label: '9. Do you have a Student Loan or Postgraduate Loan which is not fully repaid?', required: true },
      { type: 'yesno', key: 'repaying_direct', label: '10. Are you repaying your loan directly to the Student Loans Company by agreed monthly payments?', required: true, showIf: { key: 'student_loan', eq: 'yes' } },
      { type: 'checkboxes', key: 'loan_plan', label: '11. What type of loan do you have?', showIf: { key: 'repaying_direct', eq: 'no' }, options: opts('Plan 1', 'Plan 2', 'Plan 4', 'Plan 5', 'Postgraduate Loan'), help: 'Plan 1: Scotland/NI, or England/Wales before Sept 2012. Plan 2: England/Wales from Sept 2012. Plan 4: Scotland. Plan 5: England from Aug 2023.' },
      { type: 'yesno', key: 'finished_studies', label: '12. Did you finish your studies before the last 6 April?', showIf: { key: 'student_loan', eq: 'yes' } },
      { type: 'heading', title: 'Signature' },
      { ac: 'name', type: 'text', key: 'name', label: 'Name', width: 'half', required: true, prefill: 'fullname' },
      { type: 'signature', key: 'signature', label: 'Signature', required: true },
    ],
  },
  {
    key: 'bank',
    num: 9,
    title: 'Bank details',
    short: 'Bank details',
    icon: 'bank',
    confidential: true,
    intro: 'Pre-employment checklist – to be completed before any start date is confirmed. Your bank details are encrypted and only visible to authorised payroll staff.',
    fields: [
      { ac: 'name', type: 'text', key: 'account_name', label: 'Account holder name', required: true, prefill: 'fullname' },
      { type: 'text', key: 'bank_name', label: 'Bank / building society', width: 'half', required: true },
      { type: 'text', key: 'sort_code', label: 'Sort code', width: 'quarter', required: true, pattern: 'sortcode', placeholder: '12-34-56', inputmode: 'numeric' },
      { type: 'text', key: 'account_number', label: 'Account number', width: 'quarter', required: true, pattern: 'account', inputmode: 'numeric', placeholder: '12345678' },
      { type: 'text', key: 'roll_number', label: 'Building society roll number (if applicable)', width: 'half' },
      { ac: 'email', type: 'email', key: 'payslip_email', label: 'Confirm email address for payslips', width: 'half', required: true, pattern: 'email', prefill: 'email' },
      { type: 'confirm', key: 'confirm', label: 'I confirm these bank details are correct and in my name.', required: true },
      { type: 'signature', key: 'signature', label: 'Signature', required: true },
    ],
  },
];

const byKey = Object.fromEntries(sections.map((s) => [s.key, s]));

// Evaluate a showIf rule against a data object (section data or repeater row).
function visible(field, data) {
  const r = field.showIf;
  if (!r) return true;
  const v = data ? data[r.key] : undefined;
  if (r.eq !== undefined) return v === r.eq;
  if (r.ne !== undefined) return v !== r.ne;
  if (r.in) return r.in.includes(v);
  return true;
}

// Every file-field key in a section (incl. inside repeaters) – used to check required uploads.
function isEmpty(v) {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

// Validate a section. docsByField: { fieldKey: count } for uploaded files.
function validateSection(section, data, docsByField = {}) {
  const errors = {};
  const check = (fields, obj, prefix) => {
    for (const f of fields) {
      if (['info', 'heading', 'timeline'].includes(f.type)) continue;
      if (!visible(f, obj)) continue;
      const path = prefix + f.key;
      const v = obj[f.key];
      if (f.type === 'repeater') {
        const rows = Array.isArray(v) ? v : [];
        if (f.min && rows.length < f.min) errors[path] = `Please add at least ${f.min} ${f.min === 1 ? 'entry' : 'entries'}.`;
        rows.forEach((row, i) => check(f.fields, row || {}, `${path}.${(row && row._id) || i}.`));
        continue;
      }
      if (f.type === 'files') {
        if (f.required && !docsByField[path]) errors[path] = 'Please upload at least one file.';
        continue;
      }
      if (f.type === 'signature') {
        if (f.required && !(v && v.image)) errors[path] = 'Please sign here.';
        continue;
      }
      if (f.type === 'confirm') {
        if (f.required && v !== 'yes') errors[path] = 'Please confirm to continue.';
        continue;
      }
      // Postcodes follow UK rules only for UK addresses; elsewhere they are free text and optional.
      const foreignPostcode = f.pattern === 'postcode' && obj.country && obj.country !== 'GB';
      if (isEmpty(v)) {
        if (f.required && !foreignPostcode) errors[path] = 'This field is required.';
        continue;
      }
      if (f.pattern && !foreignPostcode && PATTERNS[f.pattern] && !PATTERNS[f.pattern].re.test(String(v).trim())) errors[path] = PATTERNS[f.pattern].msg;
      if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors[path] = 'Enter a valid date.';
      if (f.type === 'month' && !/^\d{4}-\d{2}$/.test(v)) errors[path] = 'Enter month and year (YYYY-MM).';
    }
  };
  check(section.fields, data, '');
  if (section.validate && !Object.keys(errors).length) section.validate(data, errors);
  return errors;
}

function optionLabel(field, value) {
  const o = (field.options || []).find((x) => x.value === value);
  return o ? o.label : value;
}

module.exports = { sections, byKey, visible, validateSection, optionLabel, PATTERNS, YES_NO };
