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

const CACHE = 'menuplan-v6.83';
const DOKUMENT = './menuplan-app.html';

// Pfade, die immer ans Netz gehen müssen.
const NUR_NETZ = [/\/generate\b/, /\/gh\//, /\/bring/, /\/auth\b/,
                  /\/share\b/, /\/r\//, /\/users\b/, /api\.anthropic\.com/];

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

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;
  if (NUR_NETZ.some((r) => r.test(url))) return;   // durchreichen, nicht anfassen

  e.respondWith(
    fetch(e.request)
      .then((antwort) => {
        // Nur erfolgreiche Antworten ablegen.
        if (antwort && antwort.ok) {
          const kopie = antwort.clone();
          caches.open(CACHE).then((c) => c.put(e.request, kopie));
        }
        return antwort;
      })
      .catch(() => caches.match(e.request).then((t) => {
        if (t) return t;
        // Das App-Dokument nur als Ersatz fuer einen SEITENAUFRUF liefern.
        // Frueher bekam auch ein fehlendes Bild das HTML zurueck - mit
        // falschem Content-Type statt eines sauberen Fehlers.
        if (e.request.mode === 'navigate') return caches.match(DOKUMENT);
        return new Response('Offline', { status: 504, statusText: 'Offline' });
      }))
  );
});

// Erlaubt der App, ein wartendes Update sofort zu übernehmen.
self.addEventListener('message', (e) => {
  if (e.data === 'jetzt-aktualisieren') self.skipWaiting();
});
