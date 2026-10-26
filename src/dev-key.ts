/**
 * Public key that pins the extension id of DEVELOPMENT builds, so the Turbobulls app's dev server
 * can address an unpacked build. Store builds leave it out: the stores assign their own ids.
 * Only the public half exists; nothing can be signed with it.
 */
export const DEV_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAo0P3IgQoenxR+uu03XH1n4ZHhlwCn0boncP7JuSLFQY2sCFSdK/Zs9J9dyT5BS1daVOPxUxxbqa/Erx1+tf0JGu2IiV77LUnuATE+dpZtvngvyVePpNScdQ/C7Ys8nnpOTKa8sCNw1dW4cQYdg/qfO4Cnx2MQMEhX3mk3IXsLHIZJ78ik1Nk56KdMGt230APIJ8W2LiUKJzCmWu28//4giegrpGl0PMywpGgd9fC4kpVCIdenBytW4F5uZFO3OHA4raln1FyfKODfjvGIgrccnnLqgsiNH83LneAg9Rr/P3UgDN5I6xRlAYiE7jemy8Y4BRYiuEEc/Czhn4f7kgPhwIDAQAB'

/** The id Chrome gives a build carrying DEV_PUBLIC_KEY (`pnpm dev-id` recomputes it). */
export const DEV_EXTENSION_ID = 'flnofeaegigjpjinmbhlfgagajconknk'
