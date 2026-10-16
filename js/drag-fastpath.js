        (function(){
          // ---- Fast positions-only update (panels + splitters) ----
          function updatePositionsFast(){
            try{
              const container = document.getElementById('panelsContainer');
              if(!container) return;
              const panels = container.querySelectorAll('.panel');
              // panelWidths & SPLITTER_WIDTH are provided by existing code
              if(!Array.isArray(window.panelWidths) || typeof window.SPLITTER_WIDTH !== 'number') return;
              let x = 0;
              for(let i=0;i<window.panelWidths.length;i++){
                const p = panels[i];
                if(!p) continue;
                const w = window.panelWidths[i] | 0;
                p.style.left = x + 'px';
                p.style.transform = 'translateX(' + x + 'px)';
                p.style.width = w + 'px';
                x += w + (i < window.panelWidths.length - 1 ? window.SPLITTER_WIDTH : 0);
              }
              const splitters = container.querySelectorAll('.splitter');
              x = 0;
              for(let i=0;i<splitters.length;i++){
                x += window.panelWidths[i] | 0;
                const left = x + i * window.SPLITTER_WIDTH;
                const s = splitters[i];
                if(!s) continue;
                s.style.left = left + 'px';
                s.style.transform = 'translateX(' + left + 'px)';
              }
            }catch(err){ /* silent */ }
          }

          window.updatePositionsFast = updatePositionsFast;

          // ---- rAF batcher that preserves original refresh order ----
          let rafPending = false;
          function refreshAllRAF(){
            if(rafPending) return;
            rafPending = true;
            requestAnimationFrame(function(){
              rafPending = false;
              if(typeof __origRefreshAll === 'function'){
                __origRefreshAll();
              } else if (typeof window.refreshAll === 'function' && window.refreshAll !== refreshAllRAF){
                // Fallback: call current refresh if we couldn't capture original
                window.refreshAll();
              }
            });
          }
          window.refreshAllRAF = refreshAllRAF;

          // ---- Capture original refreshAll (if defined) and wrap it during drags ----
          const __origRefreshAll = (typeof window.refreshAll === 'function') ? window.refreshAll : null;

          // Global drag flag toggled from capture listeners on splitters
          window.__draggingSplitter = false;

          // Event delegation: mark when a splitter drag starts/ends (capture phase so we don't depend on existing handlers)
          document.addEventListener('pointerdown', function(e){
            if(!(e.target && e.target.classList && e.target.classList.contains('splitter'))) return;
            window.__draggingSplitter = true;
            // Snap first frame immediately
            updatePositionsFast();
          }, true);
          document.addEventListener('pointerup', function(){ window.__draggingSplitter = false; }, true);
          document.addEventListener('pointercancel', function(){ window.__draggingSplitter = false; }, true);

          // If there is an existing refreshAll, replace it with a wrapper that:
          //  - on drag: does a fast position update immediately and queues the heavy refresh via rAF
          //  - otherwise: calls through synchronously (unchanged behavior)
          if(__origRefreshAll){
            window.refreshAll = function(){
              if(window.__draggingSplitter){
                updatePositionsFast();
                return refreshAllRAF();
              }
              return __origRefreshAll();
            }
          }

          // Also try to intercept common direct calls from drag handlers that might set widths
          // by listening to pointermove at capture and nudging positions fast when dragging.
          document.addEventListener('pointermove', function(){
            if(window.__draggingSplitter) updatePositionsFast();
          }, true);
        })();
