import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import Reveal from '../components/ui/Reveal';
import { media } from '../assets/media';

const sections = [
  {
    kicker: 'Our Philosophy',
    title: 'Slow is the new fast.',
    image: media.craftPortrait,
    paragraphs: [
      "In a world obsessed with speed, we choose patience. A single pair of DENIMQUE jeans takes 14 hours to complete. We use vintage shuttle looms that produce three metres of fabric an hour — modern machines do thirty.",
      'The result is denim with soul. Fabric that breathes, moves, and fades according to your life, not a factory pattern.',
    ],
  },
  {
    kicker: 'The Fabric',
    title: "From the world's last looms.",
    image: media.fabricPortrait,
    reverse: true,
    paragraphs: [
      'We source from Kojima, Japan and Cone Mills, USA — among the few remaining producers of genuine shuttle-loomed selvedge. Our cotton comes from sustainably managed farms in Zimbabwe and California.',
      'Every roll is inspected by hand. Imperfections a machine would miss are caught, marked, and either repaired or rejected.',
    ],
  },
  {
    kicker: 'The Craft',
    title: 'One artisan, start to finish.',
    image: media.overshirt,
    paragraphs: [
      'No assembly line. One maker cuts, sews and finishes each garment, then stitches their signature inside the waistband.',
      'It is slower, more expensive, and entirely the point. Accountability you can hold in your hands.',
    ],
  },
  {
    kicker: 'The People',
    title: 'Paid for the hours it takes.',
    image: media.atelierWide,
    reverse: true,
    paragraphs: [
      'Our atelier employs 24 makers on permanent contracts, with wages set against the hours a garment actually needs — never against a quota.',
      'We publish our supplier list annually because a claim you cannot check is only marketing.',
    ],
  },
];

export default function About() {
  return (
    <>
      <Helmet>
        <title>About — DENIMQUE</title>
        <meta
          name="description"
          content="The DENIMQUE story: selvedge denim woven on vintage looms, cut and finished by a single artisan in Biella since 2018."
        />
        <link rel="canonical" href="https://denimque.com/about" />
      </Helmet>

      <div className="pt-28 lg:pt-36">
        {/* Editorial opening */}
        <section className="px-6 py-24 text-center lg:px-12 lg:py-40">
          <span className="mb-6 block text-meta uppercase text-denim">The Brand</span>
          <h1 className="mx-auto mb-8 max-w-4xl font-display text-display-xl">
            We don't make clothes.
            <br />
            We make heirlooms.
          </h1>
          <p className="mx-auto max-w-2xl text-body-lg leading-relaxed text-mist">
            DENIMQUE was born from a simple belief: the best things get better with time. Our denim
            is designed to be worn, faded, repaired, and passed down.
          </p>
        </section>

        {sections.map((s, i) => (
          <section
            key={s.kicker}
            className={`px-6 py-24 lg:px-12 ${i % 2 === 0 ? 'bg-charcoal' : ''}`}
          >
            <div className="mx-auto grid max-w-[110rem] grid-cols-1 items-center gap-16 lg:grid-cols-2">
              <Reveal className={s.reverse ? 'order-1 lg:order-2' : ''}>
                <span className="mb-4 block text-meta uppercase text-denim">{s.kicker}</span>
                <h2 className="mb-6 font-display text-display-md">{s.title}</h2>
                {s.paragraphs.map((p) => (
                  <p key={p.slice(0, 24)} className="mb-6 text-body-lg leading-relaxed text-mist">
                    {p}
                  </p>
                ))}
              </Reveal>

              <Reveal
                delay={0.1}
                className={s.reverse ? 'order-2 lg:order-1' : ''}
              >
                <div className="aspect-[4/5] overflow-hidden">
                  <img
                    src={s.image}
                    alt={s.title}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              </Reveal>
            </div>
          </section>
        ))}

        {/* Numbers */}
        <section className="border-y border-stone/30 px-6 py-24 lg:px-12">
          <div className="mx-auto grid max-w-[110rem] grid-cols-2 gap-8 lg:grid-cols-4">
            {[
              { number: '14', label: 'Hours per garment' },
              { number: '1', label: 'Artisan per piece' },
              { number: '47', label: 'Body measurements' },
              { number: '50', label: 'Pieces per drop' },
            ].map((stat, i) => (
              <Reveal key={stat.label} delay={i * 0.08} className="text-center">
                <span className="mb-2 block font-display text-5xl text-pearl lg:text-7xl">
                  {stat.number}
                </span>
                <span className="text-meta uppercase text-fog">{stat.label}</span>
              </Reveal>
            ))}
          </div>
        </section>

        {/* The Future */}
        <section className="px-6 py-24 text-center lg:px-12 lg:py-32">
          <Reveal className="mx-auto max-w-3xl">
            <span className="mb-6 block text-meta uppercase text-denim">The Future</span>
            <h2 className="mb-6 font-display text-display-md">Repair, don't replace.</h2>
            <p className="mb-10 text-body-lg leading-relaxed text-mist">
              Every DENIMQUE piece carries a lifetime repair promise. Send it back at any age and our
              atelier will mend it — chain-stitched, matched thread, no charge for the first two
              repairs.
            </p>
            <Link
              to="/contact"
              className="border border-pearl/40 px-10 py-4 text-sm uppercase tracking-[0.2em] text-pearl transition-colors hover:bg-pearl hover:text-obsidian"
            >
              Talk to the atelier
            </Link>
          </Reveal>
        </section>
      </div>
    </>
  );
}
