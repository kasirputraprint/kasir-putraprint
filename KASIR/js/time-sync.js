(function() {
    const OriginalDate = window.Date;
    
    // Ambil offset yang tersimpan di cache jika ada, agar langsung ter-apply saat load
    let timeOffset = parseInt(localStorage.getItem('timeOffsetMs')) || 0;

    // Ambil waktu realtime dari server (Asia/Jakarta) dengan fallback
    function fetchTime() {
        // Coba API pertama
        fetch('https://worldtimeapi.org/api/timezone/Asia/Jakarta')
            .then(r => {
                if (!r.ok) throw new Error('API 1 error');
                return r.json();
            })
            .then(data => applyOffset(new OriginalDate(data.datetime).getTime()))
            .catch(e => {
                // Fallback ke API kedua jika API pertama gagal/diblokir (misal karena AdBlock atau CORS)
                console.warn('API 1 gagal, mencoba API alternatif...', e);
                fetch('https://timeapi.io/api/Time/current/zone?timeZone=Asia/Jakarta')
                    .then(r => {
                        if (!r.ok) throw new Error('API 2 error');
                        return r.json();
                    })
                    .then(data => applyOffset(new OriginalDate(data.dateTime).getTime()))
                    .catch(e2 => console.error('Gagal sinkronisasi waktu dari semua API, menggunakan waktu lokal/cache:', e2));
            });
    }

    function applyOffset(serverTime) {
        const localTime = OriginalDate.now();
        timeOffset = serverTime - localTime;
        localStorage.setItem('timeOffsetMs', timeOffset.toString());
        console.log('Waktu berhasil disinkronkan. Offset (ms):', timeOffset);
    }

    fetchTime();

    // Override global Date dengan Proxy
    window.Date = new Proxy(OriginalDate, {
        construct(target, args) {
            if (args.length === 0) {
                return new target(target.now() + timeOffset);
            }
            return new target(...args);
        },
        apply(target, thisArg, args) {
            if (args.length === 0) {
                return new target(target.now() + timeOffset).toString();
            }
            return target(...args).toString();
        },
        get(target, prop) {
            if (prop === 'now') {
                return function() {
                    return target.now() + timeOffset;
                };
            }
            return target[prop];
        }
    });
})();
