import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowRight } from 'lucide-react';
import HeroSection from '../components/hero/HeroSection';
import StorySection from '../components/storytelling/StorySection';
import ProductCard from '../components/products/ProductCard';
import Reveal from '../components/ui/Reveal';
import { api } from '../services/api';
import { media } from '../assets/media';
import { heroMedia } from '../data/hero';
import type { Product } from '../types';

export default function Home() {
  const [featured, setFeatured] = useState<Product[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getFeatured()
      .then((res) => !cancelled && setFeatured(res.products))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Helmet>
        <title>DENIMQUE — Denim, Redefined.</title>
        <meta
          name="description"
          content="Premium selvedge denim, cut and finished by a single artisan in Biella. Built for those who refuse ordinary."
        />
        <link rel="canonical" href="https://denimque.com/" />
        <meta property="og:title" content="DENIMQUE — Denim, Redefined." />
        <meta property="og:image" content={heroMedia.poster} />
      </Helmet>

      <HeroSection />
      <StorySection />

      {/* Featured collection */}
      <section className="px-6 py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[110rem]">
          <Reveal className="mb-16 flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <span className="mb-4 block text-meta uppercase text-denim">The Collection</span>
              <h2 className="font-display text-display-lg">New Arrivals</h2>
            </div>
            <Link
              to="/shop"
              className="group flex items-center gap-2 text-meta uppercase text-mist transition-colors hover:text-pearl"
            >
              View All
              <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
            </Link>
          </Reveal>

          {failed ? (
            <p className="text-mist">
              The collection is loading slowly right now.{' '}
              <Link to="/shop" className="text-denim link-underline">
                Browse the shop
              </Link>{' '}
              instead.
            </p>
          ) : featured.length === 0 ? (
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="aspect-[3/4] animate-pulse bg-charcoal" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
              {featured.map((p, i) => (
                <ProductCard key={p.id} product={p} index={i} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Editorial banner */}
      <section className="relative h-[70vh] overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${media.atelierWide})` }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-obsidian/60" />
        <div className="absolute inset-0 grain" aria-hidden="true" />

        <Reveal className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
          <span className="mb-6 text-meta uppercase text-denim">The Atelier</span>
          <h2 className="mb-8 max-w-3xl font-display text-display-lg">
            Some things are made
            <br />
            to disappear into the dark.
            <br />
            <em className="text-mist">This one was made to own it.</em>
          </h2>
          <Link
            to="/about"
            className="border border-pearl/40 px-10 py-4 text-sm uppercase tracking-[0.2em] text-pearl transition-all duration-500 ease-editorial hover:bg-pearl hover:text-obsidian"
          >
            Our Story
          </Link>
        </Reveal>
      </section>

      {/* Craft */}
      <section className="px-6 py-24 lg:px-12 lg:py-32">
        <div className="mx-auto grid max-w-[110rem] grid-cols-1 items-center gap-16 lg:grid-cols-2">
          <Reveal>
            <span className="mb-4 block text-meta uppercase text-denim">The Craft</span>
            <h2 className="mb-6 font-display text-display-md">
              One artisan.
              <br />
              One garment.
            </h2>
            <p className="mb-6 text-body-lg leading-relaxed text-mist">
              We don't believe in assembly lines. Each DENIMQUE piece is cut, sewn, and finished by a
              single craftsperson in our Biella atelier. Their signature is stitched inside — a
              promise that one person stood behind every seam.
            </p>
            <p className="text-body-lg leading-relaxed text-mist">
              This is slow fashion in its truest form. A pair of our jeans takes 14 hours to
              complete. The result is a garment that fits better, lasts longer, and tells a story.
            </p>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="aspect-[4/5] overflow-hidden">
              <img
                src={media.craftPortrait}
                alt="An artisan finishing a chain-stitched hem in the Biella atelier"
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </div>
          </Reveal>
        </div>
      </section>

      {/* Customization teaser */}
      <section className="border-y border-stone/30 bg-charcoal px-6 py-24 lg:px-12">
        <Reveal className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <span className="mb-6 text-meta uppercase text-denim">Make Your Denim</span>
          <h2 className="mb-6 font-display text-display-md">YOUR DENIM. YOUR STORY.</h2>
          <p className="mb-10 max-w-xl text-body-lg text-mist">
            Choose the wash, the stitch, the buttons and the patch. We cut it to your measurements
            and stamp it with an edition number that belongs to you alone.
          </p>
          <Link
            to="/customize"
            className="bg-pearl px-10 py-4 text-sm uppercase tracking-[0.2em] text-obsidian transition-colors hover:bg-white"
          >
            Start Configuring
          </Link>
        </Reveal>
      </section>
    </>
  );
}
