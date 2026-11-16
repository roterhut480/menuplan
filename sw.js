// Menüplan Service Worker v1
//
// Zweck: Die App soll sich ohne Internet öffnen lassen. Alle Daten liegen
// ohnehin lokal; bisher fehlte nur das Dokument selbst.
//
// Strategie bewusst NETWORK-FIRST für das App-Dokument: Eine neue Version
// greift damit sofort, der Cache springt nur ein, wenn kein Netz da ist.
// Cache-First wäre schneller, würde aber nach jedem Deployment die alte
// Version ausliefern, bis der Cache von Hand geleert wird.
//
// API-Aufrufe werden NIE zwischengespeichert - eine gecachte Menügenerierung
// oder ein gecachter Bring!-Import wären schlimmer als ein Fehler.

const CACHE = 'menuplan-v7.19';
const DOKUMENT = './menuplan-app.html';

// Pfade, die immer ans Netz gehen müssen.
const NUR_NETZ = [/\/generate\b/, /\/gh\//, /\/bring/, /\/auth\b/, /\/login\b/, /\/logout\b/,
                  /\/share\b/, /\/r\//, /\/users\b/, /\/ping\b/, /api\.anthropic\.com/,
                  /\.workers\.dev\//];       // der ganze Worker: API-Antworten (auch Fehler) nie anfassen

// Hoechstens so lange auf das Netz warten, wenn eine zwischengespeicherte Fassung bereitliegt.
// Ohne Cache gibt es nichts, worauf man zurueckfallen koennte - dann wird normal gewartet.
const NETZ_TIMEOUT_MS = 6000;

self.addEventListener('install', (e) => {
  // NUR das App-Dokument vorab ablegen. Frueher stand hier auch './' - auf
  // GitHub Pages liefert das Verzeichnis ohne index.html aber eine 404, und
  // addAll() bricht bei JEDER nicht-2xx-Antwort komplett ab. Ergebnis: der
  // Service Worker installierte sich NIE. Ein lokaler Testserver verdeckte
  // das, weil er fuer './' eine Verzeichnisauflistung mit 200 liefert.
  //
  // KEIN skipWaiting() hier: die neue Fassung soll warten, bis der Nutzer im
  // Hinweis auf "Neu laden" tippt. Sonst uebernimmt sie sofort und die Seite
  // laedt mitten in der Bedienung neu.
  e.waitUntil(caches.open(CACHE).then((c) => c.add(DOKUMENT)));
});

self.addEventListener('activate', (e) => {
  // Alte Versionen entfernen, damit sich nicht alte und neue Stände mischen.
  e.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(
        namen.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Ersatz aus dem Cache: die genaue Anfrage, bei einem Seitenaufruf sonst das App-Dokument.
// Das App-Dokument wird NUR fuer Seitenaufrufe geliefert - ein fehlendes Bild oder eine
// API-Antwort bekommt nie HTML zurueck.
async function ersatz(request) {
  const t = await caches.match(request);
  if (t) return t;
  if (request.mode === 'navigate') return caches.match(DOKUMENT);
  return null;
}

function mitZeitlimit(request, ms) {
  if (!ms || typeof AbortController === 'undefined') return fetch(request);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(request, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function netzZuerst(request) {
  const vorhanden = await ersatz(request);
  let antwort;
  try {
    antwort = await mitZeitlimit(request, vorhanden ? NETZ_TIMEOUT_MS : 0);
  } catch (err) {
    // Kein Netz oder zu langsam (haengende Verbindung).
    return vorhanden || new Response('Offline', { status: 504, statusText: 'Offline' });
  }
  if (antwort && antwort.ok) {
    // Nur erfolgreiche Antworten ablegen.
    const kopie = antwort.clone();
    caches.open(CACHE).then((c) => c.put(request, kopie));
    return antwort;
  }
  // Serverfehler (502/503/504 ...): lieber die gespeicherte Fassung als eine Fehlerseite.
  // 4xx (z. B. 404) bleibt unveraendert - das ist eine echte Antwort.
  if (antwort && antwort.status >= 500 && vorhanden) return vorhanden;
  return antwort;
}

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;
  if (NUR_NETZ.some((r) => r.test(url))) return;   // durchreichen, nicht anfassen
  e.respondWith(netzZuerst(e.request));
});

// Erlaubt der App, ein wartendes Update sofort zu übernehmen.
self.addEventListener('message', (e) => {
  if (e.data === 'jetzt-aktualisieren') self.skipWaiting();
});
