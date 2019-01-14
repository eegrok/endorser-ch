import l from '../../common/logger'
import base64url from 'base64url'
import util from 'util'
import db from './endorser.db.service'
import didJwt from 'did-jwt'
// I wish this was exposed in the did-jwt module!
import VerifierAlgorithm from '../../../node_modules/did-jwt/lib/VerifierAlgorithm'
// I couldn't figure out how to import this directly from the module.  Sheesh.
const resolveAuthenticator = require('./crypto/JWT').resolveAuthenticator

require("ethr-did-resolver").default() // loads resolver for "did:ethr"

class JwtService {

  async byQuery(params) {
    l.info(`${this.constructor.name}.byQuery(${util.inspect(params)})`);
    var resultData = []
    if (params.subject) {
      if (params.claimType) {
        resultData = await db.jwtBySubjectClaimType(params.subject, params.claimType)
      } else {
        throw new Error("That query is not implemented.")
      }
    } else if (params.claimType) {
      resultData = await db.jwtByClaimType(params.claimType)
    } else if (Object.keys(params).length == 0) {
      resultData = await db.jwtLatest()
    } else {
      throw new Error("That query is not implemented.")
    }
    let result = resultData.map(j => ({id:j.id, issuedAt:j.issuedAt, subject:j.subject, claimContext:j.claimContext, claimType:j.claimType, claimEncoded:j.claimEncoded}))
    return result;
  }

  byId(id) {
    l.info(`${this.constructor.name}.byId(${id})`);
    return db.jwtById(id);
  }

  jwtDecoded(encoded) {

    // this line is lifted from didJwt.verifyJWT
    const {payload, header, signature, data} = didJwt.decodeJWT(encoded)
    l.debug(payload, "payload")
    l.trace(header, "header")
    l.trace(signature, "signature")
    l.trace(data, "data")

    return {payload, header, signature, data}
  }

  create(jwtEncoded) {
    l.info(`${this.constructor.name}.create(ENCODED)`);
    l.trace(jwtEncoded, "ENCODED")

    const {payload, header, signature, data} = this.jwtDecoded(jwtEncoded)
    let claimEncoded = base64url.encode(payload.claim)
    let entity = db.buildJwtEntity(payload, claimEncoded, jwtEncoded)
    return db.jwtInsert(entity)
  }

  async createWithClaimRecord(jwtEncoded) {
    l.info(`${this.constructor.name}.createWithClaimRecords(ENCODED)`);
    l.trace(jwtEncoded, "ENCODED")

    const {payload, header, signature, data} = this.jwtDecoded(jwtEncoded)
    let claimEncoded = base64url.encode(JSON.stringify(payload.claim))
    let entity = db.buildJwtEntity(payload, claimEncoded, jwtEncoded)
    let jwtId = await db.jwtInsert(entity)

    // this line is lifted from didJwt.verifyJWT
    const {doc, authenticators, issuer} = await resolveAuthenticator(header.alg, payload.iss, undefined)
    l.debug(doc, "doc")
    l.trace(authenticators, "authenticators")
    l.trace(issuer, "issuer")

    let DID = doc.id

    // this is the same as the doc.publicKey in my example
    //const signer = VerifierAlgorithm(header.alg)(data, signature, authenticators)

    if (payload.claim) {
      if (payload.claim['@context'] === 'http://schema.org'
          && payload.claim['@type'] === 'JoinAction') {

        // check that the subject is the same as the agent
        if (payload.sub !== payload.claim.agent.did) {
          throw new Error("Subject of JWT doesn't match JoinAction. sub:" + payload.sub + " agent.did:" + payload.claim.agent.did)
        }

        var eventId = await db.eventIdByOrgNameNameTime(payload.claim.event.organizer.name, payload.claim.event.name, payload.claim.event.startTime)
        if (eventId === null) {
          eventId = await db.eventInsert(payload.claim.event.organizer.name, payload.claim.event.name, payload.claim.event.startTime)
          l.trace(`New event # ${eventId}`)
        }

        let attId = await db.attendanceInsert(payload.sub, eventId, claimEncoded)
        l.trace(`New attendance # ${attId}`)

      } else if (payload.claim['@context'] === 'http://endorser.ch'
                 && payload.claim['@type'] === 'Confirmation') {

        let origClaimEncoded = payload.claim['claimEncoded']
        let origClaim = JSON.parse(base64url.decode(origClaimEncoded))
        l.debug(origClaim, "Original payload being confirmed")

        // someday: check whether this really is a JoinAction
        var eventId = await db.eventIdByOrgNameNameTime(origClaim.event.organizer.name, origClaim.event.name, origClaim.event.startTime)
        if (eventId === null) throw Error("Attempted to confirm attendance at an unrecorded event.")
        let attendId = await db.attendanceIdByDidEventId(origClaim.agent.did, eventId)
        if (attendId === null) throw Error("Attempted to confirm an unrecorded attendance.")
        await db.confirmationInsert(DID, attendId, origClaimEncoded)
      }
    }

    return jwtId
  }

}

export default new JwtService();
