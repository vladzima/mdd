// The SSH library eagerly loads its Node crypto implementations even though it
// picks the WebCrypto ones in a browser. This stub satisfies that import.
export default class NodeRsaStub {
  constructor() {
    throw new Error('node-rsa is not available in the browser')
  }
}
