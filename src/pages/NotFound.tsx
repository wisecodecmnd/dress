import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

export default function NotFound() {
  return (
    <>
      <Helmet>
        <title>Not Found — DENIMQUE</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="flex min-h-[80vh] flex-col items-center justify-center px-6 text-center">
        <span className="mb-6 font-display text-display-xl text-pearl/10">404</span>
        <h1 className="mb-4 font-display text-display-md">This page went dark.</h1>
        <p className="mb-10 max-w-md text-body-lg text-mist">
          The page you're after has moved or never existed. The collection, however, is right here.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link
            to="/shop"
            className="bg-pearl px-8 py-4 text-meta uppercase text-obsidian transition-colors hover:bg-white"
          >
            Shop the collection
          </Link>
          <Link
            to="/"
            className="border border-stone/50 px-8 py-4 text-meta uppercase text-mist transition-colors hover:border-pearl hover:text-pearl"
          >
            Back home
          </Link>
        </div>
      </div>
    </>
  );
}
