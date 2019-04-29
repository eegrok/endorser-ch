import chai from 'chai'
import request from 'supertest'
import R from 'ramda'

import Server from '../server'
import { HIDDEN_TEXT, UPORT_PUSH_TOKEN_HEADER } from '../server/api/services/util'
import { allDidsAreHidden } from './util'

const expect = chai.expect

// from https://developer.uport.space/uport-credentials/reference/index and https://developer.uport.space/credentials/transactions
const { Credentials } = require('uport-credentials')
// from Credentials.createIdentity();

var creds = [
  { did: 'did:ethr:0x00c9c2326c73f73380e8402b01de9defcff2b064', privateKey: '8de6e2bd938a29a8348316cbae3811475f22f2ae87a42ad0ece727ff25c613b5' },
  { did: 'did:ethr:0x11bb3621f8ea471a750870ae8dd5f4b8203e9557', privateKey: 'e4a3d47ed1058e5c07ed825b5cf0516aab757b1d141a4dc24392271537e10aa0' },
  { did: 'did:ethr:0x22c51a43844e44b59c112cf74f3f5797a057837a', privateKey: '590e1a75d89e453d9b33f982badc4fdcd67046c8dbf4323f367b847776126d1b' },
  { did: 'did:ethr:0x332661e9e6af65eea6df253296a26257ff304647', privateKey: 'ae945c106dc5538b5dc6acffef7901ef5e30b22c80d7af0a5d466432a49eeb9c' },
  { did: 'did:ethr:0x44afb67bb333f2f61aa160532de0490f6dc9f441', privateKey: 'c729c12f5b95db8ab048b95319329f35e9165585a3e9f69f36e7309f2f1c77bc' },
  { did: 'did:ethr:0x5592ea1a9a3c9bb12abe5fc91bfa40622b24a932', privateKey: '3561bed03fb41bf3dec3926273b302f20bb25a25c723a93e1e6c9212edff6d1d' },
  { did: 'did:ethr:0x66b50b886a7df641c96f787002de3ace753bb1b1', privateKey: '7bd14ba3709d0d31f8ba56f211856bdb021655c5d99aa5ef055e875159e695a6' },
  { did: 'did:ethr:0x777d6361330d047e99bee0a275a8adb908fe5514', privateKey: 'e078084054c30a94f648cfde5bc1bbcbc341ee71431f1b37abf1dc7c8f2f5d35' },
]

var credentials = R.map((c) => new Credentials(c), creds)

let nowEpoch = Math.floor(new Date().getTime() / 1000)
let tomorrowEpoch = nowEpoch + (24 * 60 * 60)

let pushTokenProms = R.map((c) => c.createVerification({ exp: tomorrowEpoch }), credentials)

let tenureAtCornerBakeryFor0 =
    {
      "iat": nowEpoch,
      "exp": tomorrowEpoch,
      "sub": creds[0].did,
      "claim": {
        "@context": "http://endorser.ch",
        "@type": "Tenure",
        "spatialUnit": {
          "geo": {
            "@type": "GeoShape",
            "polygon": "40.883944,-111.884787 40.884088,-111.884787 40.884088,-111.884515 40.883944,-111.884515 40.883944,-111.884787"
          }
        },
        "party": {
          "did": creds[0].did
        }
      }
    }


let tenureAtFoodPantryFor0By0 =
{
  "iat": nowEpoch,
  "exp": tomorrowEpoch,
  "sub": creds[0].did,
  "claim": {
    "@context": "http://endorser.ch",
    "@type": "Tenure",
    "spatialUnit": {
      "geo": {
        "@type": "GeoShape",
        "polygon": "40.890431,-111.870292 40.890425,-111.869691 40.890867,-111.869654 40.890890-111.870295 40.890431-111.870292"
      }
    },
    "party": {
      "did": creds[0].did
    }
  },
  "iss": creds[0].did
}


let tenureAtCornerBakeryFor0By0 = R.clone(tenureAtCornerBakeryFor0)
tenureAtCornerBakeryFor0By0.iss = creds[0].did

let tenureAtCornerBakeryFor0By1 = R.clone(tenureAtCornerBakeryFor0)
tenureAtCornerBakeryFor0By1.iss = creds[1].did

let user0TokenProms =
    R.map((c) => credentials[0].createVerification(c),
          [tenureAtCornerBakeryFor0By0, tenureAtFoodPantryFor0By0])

let user1TokenProms =
    R.map((c) => credentials[0].createVerification(c),
          [tenureAtCornerBakeryFor0By1])

var pushTokens, user0Tokens, user1Tokens
before(async () => {
  await Promise.all(pushTokenProms).then((allJwts) => { pushTokens = allJwts })
  console.log("Created controller2 push tokens", pushTokens)

  await Promise.all(user0TokenProms).then((jwts) => { user0Tokens = jwts })
  console.log("Created controller2 user 0 tokens", user0Tokens)

  await Promise.all(user1TokenProms).then((jwts) => { user1Tokens = jwts })
  console.log("Created controller2 user 1 tokens", user1Tokens)
})

describe('Test Claim DID Visibility', () => {

  it('should get claims from other tests but cannot see inside any', () =>
     request(Server)
     .get('/api/claim')
     .set(UPORT_PUSH_TOKEN_HEADER, pushTokens[0])
     .expect('Content-Type', /json/)
     .then(r => {
       expect(r.body)
         .to.be.an('array')
       for (var i = 0; i < r.body.length; i++) {
         expect(allDidsAreHidden(r.body[i]))
           .to.be.true
       }
     })).timeout(5001)

  it('should create a new tenure', () =>
      request(Server)
      .post('/api/claim')
      .set(UPORT_PUSH_TOKEN_HEADER, pushTokens[0])
      .send({ "jwtEncoded": user0Tokens[0] })
      .expect('Content-Type', /json/)
      .then(r => {
        expect(r.body)
          .to.be.a('number')
      })).timeout(5001)

  it('should get claims and can see inside the most recent one', () =>
     request(Server)
     .get('/api/claim')
     .set(UPORT_PUSH_TOKEN_HEADER, pushTokens[0])
     .expect('Content-Type', /json/)
     .then(r => {
       expect(r.body)
         .to.be.an('array')
       expect(allDidsAreHidden(r.body[0]))
         .to.be.false
     })).timeout(5001)

  it('should get 2 tenure claims', () =>
     request(Server)
     .get('/api/claim?claimType=Tenure')
     .set(UPORT_PUSH_TOKEN_HEADER, pushTokens[0])
     .expect('Content-Type', /json/)
     .then(r => {
       expect(r.body)
         .to.be.an('array')
         .of.length(2)
     })).timeout(5001)

})

describe('Tenure 2: Competing Tenure Claim', () => {

  it('should create a new tenure', () =>
     request(Server)
     .post('/api/claim')
     .set(UPORT_PUSH_TOKEN_HEADER, pushTokens[0])
     .send({ "jwtEncoded": user0Tokens[0] })
     .expect('Content-Type', /json/)
     .then(r => {
       expect(r.body)
         .to.be.a('number')
     })).timeout(5001)

  it('should create another new tenure', () =>
     request(Server)
     .post('/api/claim')
     .set(UPORT_PUSH_TOKEN_HEADER, pushTokens[0])
     .send({ "jwtEncoded": user1Tokens[0] })
     .expect('Content-Type', /json/)
     .then(r => {
       expect(r.body)
         .to.be.a('number')
     })).timeout(5001)

  it('should get 4 tenure claims', () =>
     request(Server)
     .get('/api/claim?claimType=Tenure')
     .set(UPORT_PUSH_TOKEN_HEADER, pushTokens[0])
     .expect('Content-Type', /json/)
     .then(r => {
       expect(r.body)
         .to.be.an('array')
         .of.length(4)
     })).timeout(5001)

  it('should get 2 competing tenures and confirmations', () =>
     request(Server)
     .get('/api/report/tenureClaimsAndConfirmationsAtPoint?lat=40.883944&lon=-111.884787')
     .set(UPORT_PUSH_TOKEN_HEADER, pushTokens[0])
     .expect('Content-Type', /json/)
     .then(r => {
       expect(r.body)
         .to.be.an('array')
         .of.length(2)
     })).timeout(5001)

})
