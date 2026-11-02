import { Fragment, ReactNode, useState } from 'react';

/**
 * Languages. Text written as t('English words') shows in the chosen language when a translation exists, otherwise in English.
 * To add a language (Tamil, Bengali, Marathi…): add a dictionary below, add it to LANGS, and the switcher offers it.
 * School-written content (news, pages, notices) is not translated automatically: schools write it in the languages they choose.
 */
export type Lang = 'en' | 'hi';
export const LANGS: { code: Lang; label: string }[] = [{ code: 'en', label: 'English' }, { code: 'hi', label: 'हिन्दी' }];

const HI: Record<string, string> = {
  // public menu
  'About': 'परिचय', 'Academics': 'शैक्षणिक', 'Admissions': 'प्रवेश', 'Campus life': 'कैंपस जीवन', 'More': 'और', 'Menu': 'मेनू', 'Close': 'बंद करें',
  'About us': 'हमारे बारे में', "Principal's message": 'प्रधानाचार्य का संदेश', 'Vision & mission': 'दृष्टि और लक्ष्य', 'Infrastructure': 'सुविधाएँ',
  'Our approach': 'हमारा दृष्टिकोण', 'Classes & curriculum': 'कक्षाएँ और पाठ्यक्रम', 'Departments': 'विभाग', 'Faculty': 'शिक्षक',
  'How to join': 'प्रवेश कैसे लें', 'Admission enquiry': 'प्रवेश पूछताछ', 'Online admission': 'ऑनलाइन प्रवेश', 'Track application': 'आवेदन की स्थिति', 'Transport': 'परिवहन',
  'Gallery': 'गैलरी', 'Events': 'कार्यक्रम', 'Achievements': 'उपलब्धियाँ', 'Calendar': 'कैलेंडर', 'Alumni': 'पूर्व छात्र',
  'News & announcements': 'समाचार और घोषणाएँ', 'Documents': 'दस्तावेज़', 'Policies': 'नीतियाँ', 'Careers': 'करियर', 'Contact': 'संपर्क',
  // sign in
  'Welcome back': 'वापसी पर स्वागत है', 'Sign in to your account': 'अपने खाते में साइन इन करें', 'Use the login ID given to you by the school.': 'स्कूल द्वारा दी गई लॉगिन आईडी का उपयोग करें।',
  'Login ID': 'लॉगिन आईडी', 'Password': 'पासवर्ड', 'Sign in': 'साइन इन करें', 'Signing in…': 'साइन इन हो रहा है…', 'Verify': 'सत्यापित करें', 'Verification code': 'सत्यापन कोड',
  'Forgotten your password? Ask the school office to reset it.': 'पासवर्ड भूल गए? स्कूल कार्यालय से रीसेट करवाएँ।', '← Back to the website': '← वेबसाइट पर वापस',
  'Staff': 'स्टाफ', 'Parents': 'अभिभावक', 'Students': 'विद्यार्थी',
  // parent portal
  'Home': 'होम', 'Attendance': 'उपस्थिति', 'Results': 'परिणाम', 'Homework': 'गृहकार्य', 'Messages': 'संदेश', 'Talk to your child’s teachers': 'अपने बच्चे के शिक्षकों से बात करें',
  'Meet a teacher': 'शिक्षक से मिलें', 'Book a parent-teacher meeting': 'अभिभावक-शिक्षक मीटिंग बुक करें', 'Classwork': 'कक्षा कार्य', 'What is being taught and shared files': 'क्या पढ़ाया जा रहा है और साझा फ़ाइलें',
  'Beyond marks': 'अंकों से आगे', 'Activities, achievements and teacher notes': 'गतिविधियाँ, उपलब्धियाँ और शिक्षक के नोट', 'Safety': 'सुरक्षा', 'Pickup people, emergency contacts, arrivals': 'लेने वाले व्यक्ति, आपातकालीन संपर्क, आगमन',
  'Concerns': 'चिंताएँ', 'Raise a concern with the school': 'स्कूल को अपनी चिंता बताएँ', 'Route, stop, timings and driver': 'रूट, स्टॉप, समय और चालक', 'Library': 'पुस्तकालय', 'Books borrowed and due dates': 'ली गई किताबें और वापसी की तारीख',
  'Fees & receipts': 'फीस और रसीदें', 'Dues, payments and receipts': 'बकाया, भुगतान और रसीदें', 'Class timetable': 'कक्षा समय-सारणी', 'Weekly periods and teachers': 'साप्ताहिक पीरियड और शिक्षक',
  'Teacher remarks': 'शिक्षक की टिप्पणियाँ', 'Praise and notes from teachers': 'शिक्षकों की प्रशंसा और नोट', 'Notices & events': 'सूचनाएँ और कार्यक्रम', 'News from the school': 'स्कूल की खबरें',
  'Apply for leave': 'अवकाश के लिए आवेदन', 'Tell the school about an absence': 'अनुपस्थिति की सूचना स्कूल को दें', 'My account': 'मेरा खाता', 'Password and two-step verification': 'पासवर्ड और दो-चरणीय सत्यापन', 'Sign out': 'साइन आउट',
  'Emergency contacts': 'आपातकालीन संपर्क', 'Arrivals and departures': 'आगमन और प्रस्थान', 'Your meetings': 'आपकी मीटिंग', 'What’s being taught': 'क्या पढ़ाया जा रहा है', 'Learning materials': 'पढ़ाई की सामग्री',
  'Activities and achievements': 'गतिविधियाँ और उपलब्धियाँ', 'Notes from teachers': 'शिक्षकों के नोट', 'Hand in': 'जमा करें', 'Handed in': 'जमा किया', 'Remove': 'हटाएँ', 'Cancel': 'रद्द करें',
  'Book this time': 'यह समय बुक करें', 'Save contact': 'संपर्क सहेजें', 'Send for approval': 'मंज़ूरी के लिए भेजें', 'Add a person': 'व्यक्ति जोड़ें', 'Add a contact': 'संपर्क जोड़ें', 'Open link': 'लिंक खोलें', 'Open file': 'फ़ाइल खोलें',
  'Full name': 'पूरा नाम', 'Relation': 'संबंध', 'Mobile number': 'मोबाइल नंबर', 'Dark mode': 'डार्क मोड', 'Language': 'भाषा',
};
const DICT: Record<Lang, Record<string, string>> = { en: {}, hi: HI };

let current: Lang = ((): Lang => { try { const v = localStorage.getItem('lang'); return v === 'hi' ? 'hi' : 'en'; } catch { return 'en'; } })();
if (typeof document !== 'undefined') document.documentElement.lang = current;

/** Translate a phrase into the chosen language (falls back to the English text). */
export const t = (s: string): string => DICT[current][s] ?? s;
export const currentLang = () => current;

/** Wrap the app: switching language redraws the whole app in the new language (and keeps the page you are on). */
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(current);
  (window as any).__setLang = (l: Lang) => { current = l; try { localStorage.setItem('lang', l); } catch { /* ignore */ } document.documentElement.lang = l; setLang(l); };
  return <Fragment key={lang}>{children}</Fragment>;
}

/** A small switcher: shows the other language's name. */
export function LangSwitch({ className = 'btn ghost sm' }: { className?: string }) {
  const other = LANGS.find((l) => l.code !== current)!;
  return <button type="button" className={className} lang={other.code} onClick={() => (window as any).__setLang(other.code)} aria-label={`${t('Language')}: ${other.label}`}>{other.label}</button>;
}
