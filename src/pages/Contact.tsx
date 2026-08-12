import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Instagram, Mail, MapPin, Phone, Send } from 'lucide-react';
import { api } from '../services/api';
import { useUIStore } from '../store/uiStore';
import MagneticButton from '../components/ui/MagneticButton';

interface FormState {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

const EMPTY: FormState = { name: '', email: '', phone: '', subject: '', message: '' };

type Errors = Partial<Record<keyof FormState, string>>;

function validate(form: FormState): Errors {
  const errors: Errors = {};
  if (form.name.trim().length < 2) errors.name = 'Tell us your name';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email)) errors.email = 'A valid email, please';
  if (form.phone && !/^[+\d][\d\s-]{6,}$/.test(form.phone)) errors.phone = 'That number looks off';
  if (form.subject.trim().length < 3) errors.subject = 'Add a subject';
  if (form.message.trim().length < 10) errors.message = 'A little more detail, please';
  return errors;
}

export default function Contact() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const showToast = useUIStore((s) => s.showToast);

  const field = (key: keyof FormState) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
    },
    'aria-invalid': Boolean(errors[key]),
    'aria-describedby': errors[key] ? `${key}-error` : undefined,
    className:
      'w-full border-b bg-transparent py-3 text-pearl outline-none transition-colors placeholder:text-stone ' +
      (errors[key] ? 'border-red-500/70' : 'border-stone/50 focus:border-pearl'),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      showToast('Check the highlighted fields', 'error');
      return;
    }

    setStatus('sending');
    try {
      await api.sendContact({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        subject: form.subject.trim(),
        message: form.message.trim(),
      });
      setForm(EMPTY);
      setStatus('sent');
      showToast('Message sent — we reply within two working days', 'success');
    } catch (err) {
      setStatus('idle');
      showToast(err instanceof Error ? err.message : 'Message could not be sent', 'error');
    }
  };

  return (
    <>
      <Helmet>
        <title>Contact — DENIMQUE</title>
        <meta
          name="description"
          content="Talk to DENIMQUE. Email, phone, or visit the atelier in Biella, Italy."
        />
        <link rel="canonical" href="https://denimque.com/contact" />
      </Helmet>

      <div className="px-6 pb-32 pt-32 lg:px-12 lg:pt-44">
        <div className="mx-auto max-w-[110rem]">
          <span className="mb-6 block text-meta uppercase text-denim">Contact</span>
          <h1 className="mb-16 max-w-4xl font-display text-display-xl lg:mb-24">LET'S TALK.</h1>

          <div className="grid grid-cols-1 gap-20 lg:grid-cols-2">
            {/* Details */}
            <div className="space-y-12">
              <div>
                <h2 className="mb-3 font-display text-2xl">Email</h2>
                <a
                  href="mailto:hello@denimque.com"
                  className="flex items-center gap-2 text-body-lg text-mist transition-colors hover:text-denim"
                >
                  <Mail size={17} /> hello@denimque.com
                </a>
              </div>

              <div>
                <h2 className="mb-3 font-display text-2xl">Phone</h2>
                <a
                  href="tel:+390155123456"
                  className="flex items-center gap-2 text-body-lg text-mist transition-colors hover:text-denim"
                >
                  <Phone size={17} /> +39 0155 123 456
                </a>
              </div>

              <div>
                <h2 className="mb-3 font-display text-2xl">Atelier</h2>
                <p className="flex items-start gap-2 text-body-lg text-mist">
                  <MapPin size={17} className="mt-1 shrink-0" />
                  Via Roma 42, 13900 Biella, Italy
                </p>
              </div>

              <div>
                <h2 className="mb-3 font-display text-2xl">Follow</h2>
                <a
                  href="https://instagram.com/denimque"
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="DENIMQUE on Instagram"
                  className="flex h-11 w-11 items-center justify-center border border-stone/50 text-mist transition-colors hover:border-pearl hover:text-pearl"
                >
                  <Instagram size={17} />
                </a>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-6" noValidate>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <label htmlFor="name" className="mb-2 block text-meta uppercase text-fog">
                    Name
                  </label>
                  <input id="name" type="text" autoComplete="name" {...field('name')} />
                  {errors.name && (
                    <p id="name-error" className="mt-1 text-xs text-red-400">
                      {errors.name}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="email" className="mb-2 block text-meta uppercase text-fog">
                    Email
                  </label>
                  <input id="email" type="email" autoComplete="email" {...field('email')} />
                  {errors.email && (
                    <p id="email-error" className="mt-1 text-xs text-red-400">
                      {errors.email}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="phone" className="mb-2 block text-meta uppercase text-fog">
                  Phone <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <input id="phone" type="tel" autoComplete="tel" {...field('phone')} />
                {errors.phone && (
                  <p id="phone-error" className="mt-1 text-xs text-red-400">
                    {errors.phone}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="subject" className="mb-2 block text-meta uppercase text-fog">
                  Subject
                </label>
                <input id="subject" type="text" {...field('subject')} />
                {errors.subject && (
                  <p id="subject-error" className="mt-1 text-xs text-red-400">
                    {errors.subject}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="message" className="mb-2 block text-meta uppercase text-fog">
                  Message
                </label>
                <textarea id="message" rows={5} {...field('message')} className={`${field('message').className} resize-none`} />
                {errors.message && (
                  <p id="message-error" className="mt-1 text-xs text-red-400">
                    {errors.message}
                  </p>
                )}
              </div>

              <MagneticButton
                type="submit"
                disabled={status === 'sending'}
                className="flex items-center gap-2 bg-pearl px-8 py-4 text-sm uppercase tracking-[0.18em] text-obsidian transition-colors hover:bg-white disabled:opacity-50"
              >
                {status === 'sending' ? (
                  'Sending…'
                ) : (
                  <>
                    <Send size={15} /> Send Message
                  </>
                )}
              </MagneticButton>

              {status === 'sent' && (
                <p role="status" className="text-sm text-denim">
                  Thank you — your message is with the atelier.
                </p>
              )}
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
