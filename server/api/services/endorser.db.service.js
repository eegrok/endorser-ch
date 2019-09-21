const sqlite3 = require('sqlite3').verbose()
const dbInfo = require('../../../conf/flyway.js')
const db = new sqlite3.Database(dbInfo.fileLoc)
import l from '../../common/logger'




const GREATER_THAN = "_greaterThan"
const GREATER_THAN_OR_EQUAL_TO = "_greaterThanOrEqualTo"
const LESS_THAN = "_lessThan"
const LESS_THAN_OR_EQUAL_TO = "_lessThanOrEqualTo"

function constructWhere(params, excludeConfirmations) {

  var whereClause = ""
  var paramArray = []

  if (params.id) {
    params.rowid = params.id
    delete params.id
  }

  for (var param in params) {
    if (whereClause.length > 0) {
      whereClause += " AND"
    }

    var col = param
    var operator = "="
    if (col.endsWith(GREATER_THAN)) {
      col = col.substring(0, col.length - GREATER_THAN.length)
      operator = ">"
    } else if (col.endsWith(GREATER_THAN_OR_EQUAL_TO)) {
        col = col.substring(0, col.length - GREATER_THAN_OR_EQUAL_TO.length)
        operator = ">="
    } else if (col.endsWith(LESS_THAN)) {
      col = col.substring(0, col.length - LESS_THAN.length)
      operator = "<"
    } else if (col.endsWith(LESS_THAN_OR_EQUAL_TO)) {
      col = col.substring(0, col.length - LESS_THAN_OR_EQUAL_TO.length)
      operator = "<="
    }

    if (params[param].match(/\d\d\d\d-\d\d-\d\dT\d\d:\d\d:\d\d/)) {
      // treat dates differently for SQLite
      whereClause += " " + col + " " + operator + " datetime('" + params[param] + "')"
    } else {
      whereClause += " " + col + " " + operator + " ?"
      paramArray.push(params[param])
    }
  }

  if (excludeConfirmations) {
    whereClause += " claimType != 'Confirmation'"
  }

  if (whereClause.length > 0) {
    whereClause = " WHERE" + whereClause
  }
  return { clause: whereClause, params: paramArray }
}



class EndorserDatabase {

  ALL_SUBJECT_MATCH() {
    return "*"
  }

  constructor() {
    /** I feel like we should stop the DB, but this gets run twice on a kill and throws an error for some reason.
        Well, it doesn't look like it hurts anything to CTRL-C.
        We just have to find a better way on the server because a process kill leaves things hanging around.

    process.on('SIGINT', () => {
      db.close()
      console.log("Stopped DB.")
    })
    **/
  }




  /****************************************************************
   * Action
   **/

  actionClaimById(id) {
    return new Promise((resolve, reject) => {
      db.get("SELECT * FROM action_claim WHERE rowid = ?", [id], function(err, row) {
        if (err) {
          reject(err)
        } else if (row) {
          resolve({id:row.rowid, agentDid:row.agentDid, jwtId:row.jwtRowId, eventId:row.eventRowId, eventOrgName:row.eventOrgName, eventName:row.eventName, eventStartTime:row.eventStartTime})
        } else {
          resolve(null)
        }
      })
    })
  }

  actionClaimIdByDidEventId(agentDid, eventId) {
    return new Promise((resolve, reject) => {
      db.get("SELECT rowid FROM action_claim WHERE agentDid = ? AND eventRowId = ?", [agentDid, eventId], function(err, row) {
        if (err) {
          reject(err)
        } else if (row) {
          resolve(row.rowid)
        } else {
          resolve(null)
        }
      })
    })
  }

  /**
     @param object with a key-value for each column-value to filter
   **/
  actionClaimsByParams(params) {
    let where = constructWhere(params)
    return new Promise((resolve, reject) => {
      var data = []
      let sql = "SELECT rowid, * FROM action_claim" + where.clause + " ORDER BY rowid DESC LIMIT 50"
      db.each(sql, where.params, function(err, row) {

        row.id = row.rowid
        delete row.rowid
        row.eventId = row.eventRowId
        delete row.eventRowId
        row.jwtId = row.jwtRowId
        delete row.jwtRowId

        data.push(row)
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }

  /**
     @param eventId
     @returns all actions on the event outer-joined with confirmations of those actions
   **/
  retrieveActionClaimsAndConfirmationsByEventId(eventId) {
    return new Promise((resolve, reject) => {
      var data = []
      db.each("SELECT a.rowid AS aid, a.agentDid AS actionAgentDid, a.eventRowId, a.eventOrgName, a.eventName, a.eventStartTime, c.rowid AS cid, c.issuer AS confirmDid, c.actionRowId FROM action_claim a LEFT JOIN confirmation c ON c.actionRowId = a.rowid WHERE a.eventRowId = ?", [eventId], function(err, row) {
        let confirmation = row.confirmDid ? {id:row.cid, issuer:row.confirmDid, actionRowId:row.actionRowId} : null
        let both = {action:{id:row.aid, agentDid:row.actionAgentDid, eventRowId:row.eventRowId}, confirmation:confirmation}
        data.push(both)
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }

  /**
     @param dateTimeStr in ISO format
     @Returns all actions on the event outer-joined with confirmations of those actions
  **/
  retrieveActionClaimsAndConfirmationsForEventsSince(dateTimeStr) {
    return new Promise((resolve, reject) => {
      var data = []
      let sql = "SELECT a.rowid AS aid, a.agentDid AS actionAgentDid, a.eventRowId, a.eventOrgName, a.eventName, a.eventStartTime, c.rowid AS cid, c.issuer AS confirmDid, c.actionRowId FROM action_claim a LEFT JOIN confirmation c ON c.actionRowId = a.rowid WHERE a.eventStartTime >= datetime('" + dateTimeStr + "')"
      db.each(sql, [], function(err, row) {
        let confirmation = row.confirmDid ? {id:row.cid, issuer:row.confirmDid, actionId:row.actionRowId} : null
        let both = {action:{id:row.aid, agentDid:row.actionAgentDid, eventId:row.eventRowId, eventOrgName:row.eventOrgName, eventName:row.eventName, eventStartTime:row.eventStartTime}, confirmation:confirmation}
        data.push(both)
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }

  actionClaimInsert(issuerDid, agentDid, jwtId, event) {
    return new Promise((resolve, reject) => {
      var stmt = ("INSERT INTO action_claim (jwtRowId, issuerDid, agentDid, eventRowId, eventOrgName, eventName, eventStartTime) VALUES (?, ?, ?, ?, ?, ?, datetime('" + event.startTime + "'))");
      db.run(stmt, [jwtId, issuerDid, agentDid, event.id, event.orgName, event.name], function(err) {
        if (err) {
          reject(err)
        } else {
          resolve(this.lastID)
        }
      })
    })
  }




  /****************************************************************
   * Confirmation
   **/

  confirmationByIssuerAndAction(issuerDid, actionRowId) {
    return new Promise((resolve, reject) => {
      db.get("SELECT rowid, * FROM confirmation WHERE issuer = ? AND actionRowId = ?", [issuerDid, actionRowId], function(err, row) {
        if (err) {
          reject(err)
        } else if (row) {
          resolve({id:row.rowid, jwtId:row.jwtRowId, issuer:row.issuer, actionId:row.actionRowId})
        } else {
          resolve(null)
        }
      })
    })
  }

  confirmationByIssuerAndOrgRole(issuerDid, orgRoleRowId) {
    return new Promise((resolve, reject) => {
      db.get("SELECT rowid, * FROM confirmation WHERE issuer = ? AND orgRoleRowId = ?", [issuerDid, orgRoleRowId], function(err, row) {
        if (err) {
          reject(err)
        } else if (row) {
          resolve({id:row.rowid, jwtId:row.jwtRowId, issuerDid:row.issuer, orgRoleId:row.orgRoleRowId})
        } else {
          resolve(null)
        }
      })
    })
  }

  confirmationByIssuerAndTenure(issuerDid, tenureRowId) {
    return new Promise((resolve, reject) => {
      db.get("SELECT rowid, * FROM confirmation WHERE issuer = ? AND tenureRowId = ?", [issuerDid, tenureRowId], function(err, row) {
        if (err) {
          reject(err)
        } else if (row) {
          resolve({id:row.rowid, jwtId:row.jwtRowId, issuerDid:row.issuer, tenureId:row.tenureRowId})
        } else {
          resolve(null)
        }
      })
    })
  }

  /** see notes on previous usage in jwt.service.js
  confirmationsByActionClaim(actionRowId) {
    return new Promise((resolve, reject) => {
      var data = []
      const sql = "SELECT rowid, * FROM confirmation WHERE actionRowId = ?"
      db.each(sql, [actionRowId], function(err, row) {
        data.push({issuer:row.issuer})
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }

  confirmationsByTenureClaim(tenureRowId) {
    return new Promise((resolve, reject) => {
      var data = []
      const sql = "SELECT rowid, * FROM confirmation WHERE tenureRowId = ?"
      db.each(sql, [tenureRowId], function(err, row) {
        data.push({issuer:row.issuer})
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
        })
  }
  **/

  confirmationInsert(issuer, jwtRowId, origClaim, actionRowId, tenureRowId, orgRoleRowId) {
    return new Promise((resolve, reject) => {
      var stmt = ("INSERT INTO confirmation (jwtRowId, issuer, origClaim, actionRowId, tenureRowId, orgRoleRowId) VALUES (?, ?, ?, ?, ?, ?)")
      db.run(stmt, [jwtRowId, issuer, origClaim, actionRowId, tenureRowId, orgRoleRowId], function(err) {
        if (err) {
          reject(err)
        } else {
          resolve(this.lastID)
        }
      })
    })
  }




  /****************************************************************
   * Event
   **/

  eventById(id) {
    return new Promise((resolve, reject) => {
      db.get("SELECT rowid, orgName, name, startTime FROM event WHERE rowid = ?", [id], function(err, row) {
        if (err) {
          reject(err)
        } else if (row) {
          resolve({id:row.rowid, orgName:row.orgName, name:row.name, startTime:row.startTime})
        } else {
          resolve(null)
        }
      })
    })
  }

  /**
     @param object with a key-value for each column-value to filter
   **/
  eventsByParams(params) {
    let where = constructWhere(params)
    return new Promise((resolve, reject) => {
      var data = []
      let sql = "SELECT rowid, orgName, name, startTime FROM event" + where.clause + " ORDER BY startTime DESC LIMIT 50"
      db.each(sql, where.params, function(err, row) {
        data.push({id:row.rowid, orgName:row.orgName, name:row.name, startTime:row.startTime})
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }

  eventInsert(orgName, name, startTime) {
    return new Promise((resolve, reject) => {
      var stmt = ("INSERT INTO event (orgName, name, startTime) VALUES (?, ?, datetime(?))");
      db.run(stmt, [orgName, name, startTime], function(err) {
        if (err) {
          reject(err)
        } else {
          resolve(this.lastID)
        }
      })
    })
  }




  /****************************************************************
   * JWT
   **/

  buildJwtEntity(payload, claim, claimEncoded, jwtEncoded) {
    let issuedAt = new Date(payload.iat * 1000).toISOString()
    let issuer = payload.iss
    let subject = payload.sub
    let claimContext = payload.claim['@context']
    let claimType = payload.claim['@type']
    return {
      issuedAt: issuedAt,
      issuer: issuer,
      subject: subject,
      claimContext: claimContext,
      claimType: claimType,
      claim: claim,
      claimEncoded: claimEncoded,
      jwtEncoded: jwtEncoded
    }
  }

  jwtById(id) {
    return new Promise((resolve, reject) => {
      var data = null
      db.each("SELECT rowid, issuedAt, issuer, subject, claimContext, claimType, claimEncoded, jwtEncoded FROM jwt WHERE rowid = ? ORDER BY issuedAt DESC LIMIT 50", [id], function(err, row) {
        data = {id:row.rowid, issuedAt:row.issuedAt, issuer:row.issuer, subject:row.subject, claimContext:row.claimContext, claimType:row.claimType, claimEncoded:row.claimEncoded, jwtEncoded:row.jwtEncoded}
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }

  /**
     @param object with a key-value for each column-value to filter, with a special key 'excludeConfirmations' if it should exclude any claimType of 'Confirmation'
   **/
  jwtByParams(params) {
    var excludeConfirmations = params.excludeConfirmations
    if (params.excludeConfirmations) {
      delete params.excludeConfirmations
    }
    let where = constructWhere(params, excludeConfirmations)
    return new Promise((resolve, reject) => {
      var data = []
      db.each("SELECT rowid, issuedAt, issuer, subject, claimContext, claimType, claim FROM jwt" + where.clause + " ORDER BY issuedAt DESC LIMIT 50", where.params, function(err, row) {
        data.push({id:row.rowid, issuedAt:row.issuedAt, issuer:row.issuer, subject:row.subject, claimContext:row.claimContext, claimType:row.claimType, claim:row.claim})
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }

  /**
     @param string to search for in the claims
   **/
  jwtByContent(text) {
    return new Promise((resolve, reject) => {
      var data = []
      db.each("SELECT rowid, issuedAt, issuer, subject, claimContext, claimType, claim FROM jwt WHERE INSTR(claim, ?) > 0 ORDER BY issuedAt DESC LIMIT 50", [text], function(err, row) {
        data.push({id:row.rowid, issuedAt:row.issuedAt, issuer:row.issuer, subject:row.subject, claimContext:row.claimContext, claimType:row.claimType, claim:row.claim})
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      });
    })
  }

  async jwtInsert(entity) {
    return new Promise((resolve, reject) => {
      var stmt = ("INSERT INTO jwt (issuedAt, issuer, subject, claimContext, claimType, claim, claimEncoded, jwtEncoded) VALUES (datetime('" + entity.issuedAt + "'), ?, ?, ?, ?, ?, ?, ?)");
      console.log("Inserted into DB JWT with entity.claim", entity.claim)
      db.run(stmt, [entity.issuer, entity.subject, entity.claimContext, entity.claimType, entity.claim, entity.claimEncoded, entity.jwtEncoded], function(err) {
        if (err) {
          reject(err)
        } else {
          resolve(this.lastID)
        }
      })
    })
  }




  /****************************************************************
   * Org Role
   **/

  async orgRoleInsert(entity) {
    return new Promise((resolve, reject) => {
      var stmt = ("INSERT INTO org_role_claim (jwtRowId, issuerDid, orgName, roleName, startDate, endDate, memberDid) VALUES (?, ?, ?, ?, ?, ?, ?)");
      db.run(stmt, [entity.jwtRowId, entity.issuerDid, entity.orgName, entity.roleName, entity.startDate, entity.endDate, entity.memberDid], function(err) {
        if (err) {
          reject(err)
        } else {
          resolve(this.lastID)
        }
      })
    })
  }

  orgRoleClaimIdByOrgAndDates(orgName, roleName, startDate, endDate, memberDid) {
    return new Promise((resolve, reject) => {
      db.get("SELECT rowid FROM org_role_claim WHERE orgName = ? AND roleName = ? AND startDate = date('" + startDate + "') AND endDate = date('" + endDate + "') AND memberDid = ?", [orgName, roleName, memberDid], function(err, row) {
        if (err) {
          reject(err)
        } else if (row) {
          resolve(row.rowid)
        } else {
          resolve(null)
        }
      })
    })
  }

  /**
     @param orgName
     @param roleName
     @param onDate date in ISO format
     @Returns all role claims at that time, along with the confirmations
  **/
  retrieveOrgRoleClaimsAndConfirmationsOnDate(orgName, roleName, onDateStr) {
    return new Promise((resolve, reject) => {
      var data = []
      let sql = "SELECT r.rowid AS rid, r.orgName, r.roleName, r.startDate, r.endDate, r.memberDid, c.rowid AS cid, c.issuer AS confirmDid, c.orgRoleRowId FROM org_role_claim r LEFT JOIN confirmation c ON c.orgRoleRowId = r.rowid WHERE r.orgName = ? AND r.roleName = ? AND r.startDate <= date('" + onDateStr + "') AND date('" +  onDateStr + "') <= r.endDate"
      db.each(sql, [orgName, roleName], function(err, row) {
        let confirmation = row.confirmDid ? {id:row.cid, issuer:row.confirmDid, orgRoleRowId:row.orgRoleRowId} : null
        let both = {orgRole:{id:row.rid, memberDid:row.memberDid, orgName:row.orgName, roleName:row.roleName, startDate:row.startDate, endDate:row.endDate}, confirmation:confirmation}
        data.push(both)
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }




  /****************************************************************
   * Tenure
   **/

  async tenureClaimById(id) {
    return new Promise((resolve, reject) => {
      db.get("SELECT * FROM tenure_claim WHERE rowid = ?", [id], function(err, row) {
        if (err) {
          reject(err)
        } else if (row) {
          resolve({id:row.rowid, jwtId:row.jwtRowId, partyDid:row.partyDid, polygon:row.polygon})
        } else {
          resolve(null)
        }
      })
    })
  }

  /**
     @return all recent tenure claims
  **/
  tenureClaims() {
    return new Promise((resolve, reject) => {
      var data = []
      let sql = "SELECT rowid, * FROM tenure_claim ORDER BY rowid DESC LIMIT 50"
      db.each(sql, [], function(err, row) {

        row.id = row.rowid
        delete row.rowid
        row.jwtId = row.jwtRowId
        delete row.jwtRowId

        data.push(row)
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }

  async tenureByPoint(lat, lon) {
    return new Promise((resolve, reject) => {
      let data = []
      db.each("SELECT rowid, * FROM tenure_claim WHERE westlon <= ? AND ? <= eastlon AND minlat <= ? AND ? <= maxlat ORDER BY rowid DESC LIMIT 50", [lon, lon, lat, lat], function(err, row) {
        data.push({id:row.rowid, jwtRowId:row.jwtRowId, claimContext:row.claimContext, claimType:row.claimType, issuerDid:row.issuerDid, partyDid:row.partyDid, polygon:row.polygon, westlon:row.westlon, minlat:row.minlat, eastlon:row.eastlon, maxlat:row.maxlat})
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }

  async tenureClaimIdByPartyAndGeoShape(partyDid, polygon) {
    return new Promise((resolve, reject) => {
      db.get("SELECT rowid FROM tenure_claim WHERE partyDid = ? AND polygon = ?", [partyDid, polygon], function(err, row) {
        if (err) {
          reject(err)
        } else if (row) {
          resolve(row.rowid)
        } else {
          resolve(null)
        }
      })
    })
  }


  async tenureInsert(entity) {
    return new Promise((resolve, reject) => {
      var stmt = ("INSERT INTO tenure_claim (jwtRowId, issuerDid, partyDid, polygon, westlon, minlat, eastlon, maxlat) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      db.run(stmt, [entity.jwtRowId, entity.issuerDid, entity.partyDid, entity.polygon, entity.westLon, entity.minLat, entity.eastLon, entity.maxLat], function(err) {
        if (err) {
          reject(err)
        } else {
          resolve(this.lastID)
        }
      })
    })
  }

  /**
     @returns all tenures claimed at that point, plus any confirmations of them
  **/
  retrieveTenureClaimsAndConfirmationsAtPoint(lat, lon) {
    return new Promise((resolve, reject) => {
      var data = []
      db.each("SELECT t.rowid as tid, t.partyDid as tenurePartyDid, t.polygon, c.rowid AS cid, c.issuer as confirmDid, c.tenureRowId from tenure_claim t LEFT JOIN confirmation c on c.tenureRowId = t.rowid WHERE westlon <= ? AND ? <= eastlon AND minlat <= ? AND ? <= maxlat", [lon, lon, lat, lat], function(err, row) {

        let confirmation = row.confirmDid ? {id:row.cid, issuer:row.confirmDid, tenureRowId:row.tenureRowId} : null
        let both = {tenure:{id:row.tid, partyDid:row.tenurePartyDid, polygon:row.polygon}, confirmation:confirmation}
        data.push(both)
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }

  async voteInsert(entity) {
    return new Promise((resolve, reject) => {
      var stmt = ("INSERT INTO vote_claim (jwtRowId, issuerDid, actionOption, candidate, eventName, eventStartTime) VALUES (?, ?, ?, ?, ?, datetime(?))");
      db.run(stmt, [entity.jwtRowId, entity.issuerDid, entity.actionOption, entity.candidate, entity.eventName, entity.eventStartTime], function(err) {
        if (err) {
          reject(err)
        } else {
          resolve(this.lastID)
        }
      })
    })
  }

  async retrieveVoteCounts() {
    return new Promise((resolve, reject) => {
      var data = []
      var stmt = ("select candidate, actionOption, count(*) as numVotes from vote_claim group by candidate, actionOption order by count(*) desc");
      db.each(stmt, function(err, row) {

        let result = {speaker: row.candidate, title: row.actionOption, count: row.numVotes}
        data.push(result)
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }



  /****************************************************************
   * Network Visibility
   **/

  /**
    If the pair already exists, will resolve ()instead of rejecting).
   **/
  async networkInsert(subject, object) {
    return new Promise((resolve, reject) => {
      var stmt = ("INSERT OR IGNORE INTO network VALUES (?, ?)")
      db.run(stmt, [subject, object], function(err) {
        if (err) {
          // This SQLite check is no longer necessary due to "OR IGNORE". Nuke it when you've tested.
          if (err.errno === 19) {
            // If you print out this error, it looks like this:
            // { [Error: SQLITE_CONSTRAINT: UNIQUE constraint failed: network.subject, network.object] errno: 19, code: 'SQLITE_CONSTRAINT' }
            // ... where two fields are 'errno' and 'code'.  What is the rest of the stuff in there?
            // Well, hopefully this check is correct.
            resolve()
          } else {
            reject(err)
          }
        } else {
          resolve()
        }
      })
    })
  }

  // return all objects that are explicitly seen by subject
  async getSeesNetwork(subject) {
    return new Promise((resolve, reject) => {
      var data = []
      db.each("SELECT object FROM network WHERE subject = ? ORDER BY object", [subject], function(err, row) {
        data.push(row.object)
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }

  // return all objects that are seen by everyone
  async getSeenByAll() {
    return new Promise((resolve, reject) => {
      var data = []
      db.each("SELECT object FROM network WHERE subject = '" + this.ALL_SUBJECT_MATCH() + "' ORDER BY object", [], function(err, row) {
        data.push(row.object)
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }

  // return all subjects that can explicitly see object
  async getSeenByNetwork(object) {
    return new Promise((resolve, reject) => {
      var data = []
      db.each("SELECT subject FROM network WHERE object = ? ORDER BY subject", [object], function(err, row) {
        data.push(row.subject)
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }

}

export default new EndorserDatabase()
