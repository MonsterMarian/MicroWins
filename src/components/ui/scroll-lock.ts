/**
 * Zámek rolování stránky pod dialogem, panelem nebo plátnem přes celou obrazovku.
 *
 * Počítadlo místo "zapamatuj si předchozí hodnotu": dvě okna zavřená naráz
 * (Zpět při otevřeném výběru ikony) by si ji vrátila v opačném pořadí a stránka
 * by zůstala zamčená.
 */
let locks = 0;

export function lockBodyScroll(): () => void {
  locks += 1;
  document.body.style.overflow = "hidden";
  return () => {
    locks -= 1;
    if (locks === 0) document.body.style.overflow = "";
  };
}
