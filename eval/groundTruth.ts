import { PiiType } from "../src/types";

export interface GroundTruthCase {
  id: string;
  text: string;
  source: "real-document" | "synthetic";
  expected: { type: PiiType; value: string }[];
}

// === REAL-DOCUMENT CASES ===
// Verbatim excerpts from the uploaded Red Herring Prospectus, covering the PII types that
// actually occur naturally in this document: names, emails, phones, companies, addresses.
export const realDocumentCases: GroundTruthCase[] = [
  {
    id: "rd-1",
    source: "real-document",
    text: "Sarthak Malvadkar, Company Secretary and Compliance Officer, can be contacted at cs.connect@kshinternational.com, Telephone: + 91 20 4505 3237",
    expected: [
      { type: "PERSON", value: "Sarthak Malvadkar" },
      { type: "EMAIL", value: "cs.connect@kshinternational.com" },
      { type: "PHONE", value: "+ 91 20 4505 3237" },
    ],
  },
  {
    id: "rd-2",
    source: "real-document",
    text: "OUR PROMOTERS: KUSHAL SUBBAYYA HEGDE, PUSHPA KUSHAL HEGDE, RAJESH KUSHAL HEGDE, ROHIT KUSHAL HEGDE, RAKHI GIRIJA SHETTY, DHAULAGIRI FAMILY TRUST, EVEREST FAMILY TRUST, MAKALU FAMILY TRUST, BROAD FAMILY TRUST, ANNAPURNA FAMILY TRUST, KANCHENJUNGA FAMILY TRUST AND WATERLOO INDUSTRIAL PARK VI PRIVATE LIMITED",
    expected: [
      { type: "PERSON", value: "KUSHAL SUBBAYYA HEGDE" },
      { type: "PERSON", value: "PUSHPA KUSHAL HEGDE" },
      { type: "PERSON", value: "RAJESH KUSHAL HEGDE" },
      { type: "PERSON", value: "ROHIT KUSHAL HEGDE" },
      { type: "PERSON", value: "RAKHI GIRIJA SHETTY" },
      { type: "COMPANY", value: "DHAULAGIRI FAMILY TRUST" },
      { type: "COMPANY", value: "EVEREST FAMILY TRUST" },
      { type: "COMPANY", value: "MAKALU FAMILY TRUST" },
      { type: "COMPANY", value: "BROAD FAMILY TRUST" },
      { type: "COMPANY", value: "ANNAPURNA FAMILY TRUST" },
      { type: "COMPANY", value: "KANCHENJUNGA FAMILY TRUST" },
      { type: "COMPANY", value: "WATERLOO INDUSTRIAL PARK VI PRIVATE LIMITED" },
    ],
  },
  {
    id: "rd-3",
    source: "real-document",
    text: "Registered Office: 11/3, 11/4 and 11/5 Village Birdewadi Chakan Taluka - Khed Pune – 410 501 Maharashtra, India",
    expected: [
      { type: "ADDRESS", value: "11/3, 11/4 and 11/5 Village Birdewadi Chakan Taluka - Khed Pune – 410 501 Maharashtra, India" },
    ],
  },
  {
    id: "rd-4",
    source: "real-document",
    text: "KSH International Limited, Nuvama Wealth Management Limited and ICICI Securities Limited are the Book Running Lead Managers",
    expected: [
      { type: "COMPANY", value: "KSH International Limited" },
      { type: "COMPANY", value: "Nuvama Wealth Management Limited" },
      { type: "COMPANY", value: "ICICI Securities Limited" },
    ],
  },
  {
    id: "rd-5",
    source: "real-document",
    text: "Telephone: +91 22 4009 4400 Email: ksh.ipo@nuvama.com",
    expected: [
      { type: "PHONE", value: "+91 22 4009 4400" },
      { type: "EMAIL", value: "ksh.ipo@nuvama.com" },
    ],
  },
  {
    id: "rd-6",
    source: "real-document",
    text: "The whole-time director of our Company being, Rohit Kushal Hegde. For further details, see the Board of Directors section.",
    expected: [{ type: "PERSON", value: "Rohit Kushal Hegde" }],
  },
  {
    id: "rd-7",
    source: "real-document",
    text: "ICICI Venture House, Appasaheb Marathe Marg, Prabhadevi, Mumbai 400025, Maharashtra, India",
    expected: [
      { type: "ADDRESS", value: "ICICI Venture House, Appasaheb Marathe Marg, Prabhadevi, Mumbai 400025, Maharashtra, India" },
    ],
  },
  {
    id: "rd-8",
    source: "real-document",
    text: "Our manufacturing facility located at Plot No. J-25, Taloja Industrial Area, Village Padghe, Taluka Panvel, Raigad – 410 208, Maharashtra, India",
    expected: [
      { type: "ADDRESS", value: "Plot No. J-25, Taloja Industrial Area, Village Padghe, Taluka Panvel, Raigad – 410 208, Maharashtra, India" },
    ],
  },
];

// === SYNTHETIC CASES ===
// The real document contains no SSNs, credit cards, IP addresses, or DOBs (it's an Indian
// corporate filing, not a US consumer record), so these types are validated against
// hand-authored sentences instead. Also includes "hard negative" cases — text that looks
// PII-ish but isn't — to measure precision, not just recall.
export const syntheticCases: GroundTruthCase[] = [
  {
    id: "syn-ssn-1",
    source: "synthetic",
    text: "Employee record: John Smith, SSN 523-14-8892, hired March 2021.",
    expected: [
      { type: "PERSON", value: "John Smith" },
      { type: "SSN", value: "523-14-8892" },
    ],
  },
  {
    id: "syn-ssn-2",
    source: "synthetic",
    text: "Please do not share your SSN (e.g. 078-05-1120) over email.",
    expected: [{ type: "SSN", value: "078-05-1120" }],
  },
  {
    id: "syn-cc-1",
    source: "synthetic",
    text: "Card on file: 4532 0151 1283 0366, expires 09/27.",
    expected: [{ type: "CREDIT_CARD", value: "4532 0151 1283 0366" }],
  },
  {
    id: "syn-cc-2",
    source: "synthetic",
    text: "Order reference number 1234567890123456 was processed today.", // Luhn-invalid, looks card-shaped
    expected: [], // should NOT be flagged as a credit card — precision test
  },
  {
    id: "syn-ip-1",
    source: "synthetic",
    text: "The server responded from 192.168.1.104 within 20ms.",
    expected: [{ type: "IP_ADDRESS", value: "192.168.1.104" }],
  },
  {
    id: "syn-ip-2",
    source: "synthetic",
    text: "Software version 10.0.19045 was installed on the workstation.", // looks IP-ish, isn't (5 segments-ish / invalid octet range check)
    expected: [],
  },
  {
    id: "syn-dob-1",
    source: "synthetic",
    text: "Applicant: Priya Nair. Date of Birth: 14/08/1990. Contact: priya.nair88@gmail.com",
    expected: [
      { type: "PERSON", value: "Priya Nair" },
      { type: "DOB", value: "14/08/1990" },
      { type: "EMAIL", value: "priya.nair88@gmail.com" },
    ],
  },
  {
    id: "syn-dob-2",
    source: "synthetic",
    text: "The company was founded on 14/08/1990 and has grown steadily since.", // same date format, no DOB context
    expected: [],
  },
  {
    id: "syn-neg-1",
    source: "synthetic",
    text: "The WEIGHTED AVERAGE COST OF ACQUISITION PER EQUITY SHARE increased this quarter.",
    expected: [], // all-caps financial jargon — must not be flagged as a name
  },
  {
    id: "syn-neg-2",
    source: "synthetic",
    text: "SEBI ICDR Regulations require additional disclosures for RESERVATION AMONG QIBs.",
    expected: [], // regulatory acronyms/jargon — must not be flagged as a name
  },
  {
    id: "syn-honorific-1",
    source: "synthetic",
    text: "Please forward this to Mr. Arvind Kumar at arvind.kumar@examplecorp.com or +1 415 555 0134.",
    expected: [
      { type: "PERSON", value: "Arvind Kumar" },
      { type: "EMAIL", value: "arvind.kumar@examplecorp.com" },
      { type: "PHONE", value: "+1 415 555 0134" },
    ],
  },
  {
    id: "syn-company-1",
    source: "synthetic",
    text: "Acme Robotics Private Limited signed a supply agreement with Beacon Analytics LLP last week.",
    expected: [
      { type: "COMPANY", value: "Acme Robotics Private Limited" },
      { type: "COMPANY", value: "Beacon Analytics LLP" },
    ],
  },
];

export const allCases: GroundTruthCase[] = [...realDocumentCases, ...syntheticCases];
