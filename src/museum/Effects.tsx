import { Bloom, EffectComposer, N8AO, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'

import { useMuseum } from './store'
import { isTouch } from './touch'

/** Subtle camera-like finish. Keep it restrained — heavy effects look "gamey". */
export function Effects() {
  const quality = useMuseum((s) => s.quality)
  // Phones: no post-processing passes at all (the renderer's own ACES tone mapping stands in)
  if (isTouch) return null
  return (
    <EffectComposer multisampling={quality === 'high' ? 4 : 0}>
      {/* Ambient occlusion is the priciest effect left (~8 ms on Retina) — first to go.
          Never toggle it per room: mounting/unmounting rebuilds the pipeline (a visible freeze). */}
      {quality === 'high' ? <N8AO aoRadius={0.8} intensity={2.2} distanceFalloff={0.6} halfRes /> : <></>}
      <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.45} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.32} darkness={0.55} />
    </EffectComposer>
  )
}
