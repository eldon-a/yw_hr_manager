import { lazy, Suspense, useEffect, useState } from 'react';

const MembershipApp = lazy(() => import('./pages/MembershipApp.jsx'));
const PhotoUpload = lazy(() => import('./pages/PhotoUpload.jsx'));
const MemberCards = lazy(() => import('./pages/MemberCards.jsx'));
const Reconsent = lazy(() => import('./pages/Reconsent.jsx'));

const ROUTES = {
  '#/': MembershipApp,
  '#/photo': PhotoUpload,
  '#/member-card': MemberCards,
  '#/reconsent': Reconsent,
};

function normalizeInitialRoute() {
  const hash = window.location.hash;
  if (hash && ROUTES[hash.split('?')[0]]) return hash.split('?')[0];

  const page = new URLSearchParams(window.location.search).get('page');
  const mapped = {
    photo: '#/photo',
    membercard: '#/member-card',
    'member-card': '#/member-card',
    reconsent: '#/reconsent',
  }[String(page || '').toLowerCase()];
  if (mapped) return mapped;
  if (new URLSearchParams(window.location.search).has('token')) return '#/reconsent';
  return '#/';
}

function useRoute() {
  const [route, setRoute] = useState(normalizeInitialRoute);
  useEffect(() => {
    const onHashChange = () => setRoute(normalizeInitialRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return route;
}

function RouteLoading() {
  return (
    <main className="shell shell-narrow">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-card short" />
    </main>
  );
}

export default function App() {
  const route = useRoute();
  const Page = ROUTES[route] || MembershipApp;

  return (
    <Suspense fallback={<RouteLoading />}>
      <Page />
    </Suspense>
  );
}
