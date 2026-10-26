import { defineConfig } from 'wxt'
import { buildManifest } from './src/manifest'

export default defineConfig({
  srcDir: 'src',
  // Explicit imports only: every module says where its names come from.
  imports: false,
  manifest: ({ mode }) => buildManifest(mode),
})
