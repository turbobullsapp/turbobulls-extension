import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'
import { createExternalHandler } from '../external'
import { getKey } from '../keys'
import { allowedOrigins } from '../origins'
import { markPricesSent } from '../progress'
import { canReach, getCustomSources } from '../sources'

export default defineBackground(() => {
  const handle = createExternalHandler({
    allowedOrigins: allowedOrigins(import.meta.env.MODE),
    deps: {
      connector: 'extension',
      version: browser.runtime.getManifest().version,
      getKey,
      customSources: getCustomSources,
      canReach,
      fetch: (url, init) => fetch(url, init),
      openSettings: () => browser.runtime.openOptionsPage(),
    },
    onPricesSent: () => markPricesSent(),
  })

  browser.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    void handle(message, sender).then(sendResponse)
    // Answer asynchronously.
    return true
  })

  browser.action.onClicked.addListener(() => {
    void browser.runtime.openOptionsPage()
  })
})
