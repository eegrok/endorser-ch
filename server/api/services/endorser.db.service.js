const sqlite3 = require('sqlite3').verbose()
const ulidx = require('ulidx');

const dbInfo = require('../../../conf/flyway.js')
const db = new sqlite3.Database(dbInfo.fileLoc)
const util = require('./util')



const DEFAULT_LIMIT = 50

const GREATER_THAN = "_greaterThan"
const GREATER_THAN_OR_EQUAL_TO = "_greaterThanOrEqualTo"
const LESS_THAN = "_lessThan"
const LESS_THAN_OR_EQUAL_TO = "_lessThanOrEqualTo"

function constructWhere(params, claimContents, excludeConfirmations) {

  var whereClause = ""
  var paramArray = []

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

  if (claimContents) {
    if (whereClause.length > 0) {
      whereClause += " AND"
    }
    whereClause += " INSTR(claim, ?) > 0"
    paramArray.push(claimContents)
  }

  if (excludeConfirmations) {
    if (whereClause.length > 0) {
      whereClause += " AND"
    }
    whereClause += " claimType != 'AgreeAction'"
    // This is for legacy Confirmation and can be deprecated for any installations after this comment was written.
    whereClause += " AND claimType != 'Confirmation'"
  }

  if (whereClause.length > 0) {
    whereClause = " WHERE" + whereClause
  }
  return { clause: whereClause, params: paramArray }
}

function zonify(dateTime) {
  return dateTime + "Z"
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
          row.eventStartTime = zonify(row.eventStartTime)
          resolve({id:row.rowid, agentDid:row.agentDid, jwtId:row.jwtId, eventId:row.eventRowId, eventOrgName:row.eventOrgName, eventName:row.eventName, eventStartTime:row.eventStartTime})
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
        row.eventStartTime = zonify(row.eventStartTime)

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
     @param eventId
     @returns all actions on the event outer-joined with confirmations of those actions

     Result format is: { action: { id, agentDid, eventRowId }, confirmation: { id, issuer, actionRowId } }
     ... where 'confirmation' may be null.
   **/
  retrieveActionClaimsAndConfirmationsByEventData(orgName, name, startTime) {
    return new Promise((resolve, reject) => {
      var data = []
      db.each("SELECT a.rowid AS aid, a.agentDid AS actionAgentDid, a.eventRowId, a.eventOrgName, a.eventName, a.eventStartTime, c.rowid AS cid, c.issuer AS confirmDid, c.actionRowId FROM action_claim a LEFT JOIN confirmation c ON c.actionRowId = a.rowid WHERE a.eventOrgName = ? AND a.eventName = ? AND a.eventStartTime = datetime(?)", [orgName, name, startTime], function(err, row) {
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
        row.eventStartTime = zonify(row.eventStartTime)
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
      var stmt = ("INSERT INTO action_claim (jwtId, issuerDid, agentDid, eventRowId, eventOrgName, eventName, eventStartTime) VALUES (?, ?, ?, ?, ?, ?, datetime('" + event.startTime + "'))");
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

  confirmationById(confirmationId) {
    return new Promise((resolve, reject) => {
      var data = []
      const sql = "SELECT rowid, * FROM confirmation WHERE rowId = ?"
      db.each(sql, [confirmationId], function(err, row) {
        data.push({issuer: row.issuer, origClaim: row.origClaim})
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }

  // this can be replaced by confirmationByIssuerAndOrigClaim
  confirmationByIssuerAndAction(issuerDid, actionRowId) {
    return new Promise((resolve, reject) => {
      db.get("SELECT rowid, * FROM confirmation WHERE issuer = ? AND actionRowId = ?", [issuerDid, actionRowId], function(err, row) {
        if (err) {
          reject(err)
        } else if (row) {
          resolve({id:row.rowid, jwtId:row.jwtId, issuer:row.issuer, actionId:row.actionRowId})
        } else {
          resolve(null)
        }
      })
    })
  }

  confirmationByIssuerAndOrigClaim(issuerDid, claim) {
    return new Promise((resolve, reject) => {
      db.get("SELECT rowid, * FROM confirmation WHERE issuer = ? AND origClaim = ?", [issuerDid, claim], function(err, row) {
        if (err) {
          reject(err)
        } else if (row) {
          resolve({id:row.rowid, jwtId:row.jwtId})
        } else {
          resolve(null)
        }
      })
    })
  }

  // this can be replaced by confirmationByIssuerAndOrigClaim
  confirmationByIssuerAndOrgRole(issuerDid, orgRoleRowId) {
    return new Promise((resolve, reject) => {
      db.get("SELECT rowid, * FROM confirmation WHERE issuer = ? AND orgRoleRowId = ?", [issuerDid, orgRoleRowId], function(err, row) {
        if (err) {
          reject(err)
        } else if (row) {
          resolve({id:row.rowid, jwtId:row.jwtId, issuerDid:row.issuer, orgRoleId:row.orgRoleRowId})
        } else {
          resolve(null)
        }
      })
    })
  }

  // this can be replaced by confirmationByIssuerAndOrigClaim
  confirmationByIssuerAndTenure(issuerDid, tenureRowId) {
    return new Promise((resolve, reject) => {
      db.get("SELECT rowid, * FROM confirmation WHERE issuer = ? AND tenureRowId = ?", [issuerDid, tenureRowId], function(err, row) {
        if (err) {
          reject(err)
        } else if (row) {
          resolve({id:row.rowid, jwtId:row.jwtId, issuerDid:row.issuer, tenureId:row.tenureRowId})
        } else {
          resolve(null)
        }
      })
    })
  }

  confirmationsByClaim(claimStr) {
    return new Promise((resolve, reject) => {
      var data = []
      const sql = "SELECT rowid, * FROM confirmation WHERE origClaim = ?"
      db.each(sql, [claimStr], function(err, row) {
        data.push({issuer: row.issuer})
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
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

  confirmationInsert(issuer, jwtId, origClaim, actionRowId, tenureRowId, orgRoleRowId) {
    return new Promise((resolve, reject) => {
      var stmt = ("INSERT INTO confirmation (jwtId, issuer, origClaim, actionRowId, tenureRowId, orgRoleRowId) VALUES (?, ?, ?, ?, ?, ?)")
      db.run(stmt, [jwtId, issuer, origClaim, actionRowId, tenureRowId, orgRoleRowId], function(err) {
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
          row.startTime = zonify(row.startTime)
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
        row.startTime = zonify(row.startTime)
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

  buildJwtEntity(payload, claim, claimStr, claimEncoded, jwtEncoded) {
    let id = ulidx.ulid()
    let issuedAt = new Date(payload.iat * 1000).toISOString()
    let issuer = payload.iss
    let subject = payload.sub
    let claimContext = claim['@context']
    let claimType = claim['@type']
    let hashHex = util.hashedClaimWithHashedDids({id:id, claim:claimStr})
    return {
      id: id,
      issuedAt: issuedAt,
      issuer: issuer,
      subject: subject,
      claimContext: claimContext,
      claimType: claimType,
      claim: claimStr,
      claimEncoded: claimEncoded,
      jwtEncoded: jwtEncoded,
      hashHex: hashHex
    }
  }

  jwtById(id) {
    return new Promise((resolve, reject) => {
      var data = null
      db.each("SELECT id, issuedAt, issuer, subject, claimContext, claimType, claim, claimEncoded, jwtEncoded, hashHex, hashChainHex FROM jwt WHERE id = ?", [id], function(err, row) {
        row.issuedAt = zonify(row.issuedAt)
        data = {id:row.id, issuedAt:row.issuedAt, issuer:row.issuer, subject:row.subject, claimContext:row.claimContext, claimType:row.claimType, claim: row.claim, claimEncoded:row.claimEncoded, jwtEncoded:row.jwtEncoded, hashHex:row.hashHex, hashChainHex:row.hashChainHex}
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
     @param object with a key-value for each column-value to filter, with some special keys:
     - 'claimContents' for text to look for inside claims
     - 'excludeConfirmations' if it should exclude any claimType of 'AgreeAction'
     - key + '_greaterThan[OrEqualTo]' for entries with column value greater than (or equal to) the supplied value
     - key + '_lessThan[OrEqualTo]' for entries with column value less than (or equal to) the supplied value
   **/
  jwtByParams(params) {
    let claimContents = params.claimContents
    delete params.claimContents // note that value of '' is hard to detect (which is why this isn't conditional)
    let excludeConfirmations = params.excludeConfirmations
    delete params.excludeConfirmations
    let where = constructWhere(params, claimContents, excludeConfirmations)
    return new Promise((resolve, reject) => {
      var data = []
      db.each("SELECT id, issuedAt, issuer, subject, claimContext, claimType, claim, hashHex, hashChainHex FROM jwt" + where.clause + " ORDER BY issuedAt DESC LIMIT 50", where.params, function(err, row) {
        row.issuedAt = zonify(row.issuedAt)
        data.push({id:row.id, issuedAt:row.issuedAt, issuer:row.issuer, subject:row.subject, claimContext:row.claimContext, claimType:row.claimType, claim:row.claim, hashHex:row.hashHex, hashChainHex:row.hashChainHex})
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
     @param full claim text to find
  **/
  jwtByClaim(claimStr) {
    return new Promise((resolve, reject) => {
      var data = []
      db.each("SELECT id, issuedAt, issuer, subject, claimContext, claimType, claim, hashHex, hashChainHex FROM jwt WHERE claim = ?", [claimStr], function(err, row) {
        row.issuedAt = zonify(row.issuedAt)
        data.push({id:row.id, issuedAt:row.issuedAt, issuer:row.issuer, subject:row.subject, claimContext:row.claimContext, claimType:row.claimType, claim:row.claim, hashHex:row.hashHex, hashChainHex:row.hashChainHex})
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      });
    })
  }

  jwtInsert(entity) {
    return new Promise((resolve, reject) => {
      var stmt = ("INSERT INTO jwt (id, issuedAt, issuer, subject, claimType, claimContext, claim, claimEncoded, jwtEncoded, hashHex) VALUES (?, datetime('" + entity.issuedAt + "'), ?, ?, ?, ?, ?, ?, ?, ?)");
      //console.log("Inserted into DB JWT with id", entity.id, "and entity.claim", entity.claim)
      db.run(stmt, [entity.id, entity.issuer, entity.subject, entity.claimType, entity.claimContext, entity.claim, entity.claimEncoded, entity.jwtEncoded, entity.hashHex], function(err) {
        if (err) {
          reject(err)
        } else {
          resolve(this.lastID)
        }
      })
    })
  }

  allIssuerClaimTypes(issuerDid, claimTypes, afterIdInput) {
    return new Promise((resolve, reject) => {
      const afterId = afterIdInput || '0'
      const inListStr = claimTypes.map(value => "?").join(',')
      const params = [afterId, issuerDid].concat(claimTypes)
      let data = []
      let rowErr
      db.each(
        "SELECT id, issuedAt, issuer, subject, claimContext, claimType, claim, hashHex, hashChainHex FROM jwt WHERE id > ? AND issuer = ? AND claimType in (" + inListStr + ") ORDER BY id LIMIT " + DEFAULT_LIMIT,
        params,
        function(err, row) {
          if (err) {
            rowErr = err
          } else {
            row.issuedAt = zonify(row.issuedAt)
            data.push({id:row.id, issuedAt:row.issuedAt, issuer:row.issuer, subject:row.subject, claimContext:row.claimContext, claimType:row.claimType, claim:row.claim, hashHex:row.hashHex, hashChainHex:row.hashChainHex})
          }
        },
        function(allErr, num) {
          if (rowErr || allErr) {
            reject(rowErr || allErr)
          } else {
            const result = { data: data }
            if (num === DEFAULT_LIMIT) {
              result["maybeMoreAfter"] = data[data.length - 1].id;
            }
            resolve(result)
          }
        }
      )
    })
  }

  jwtLastMerkleHash() {
    return new Promise((resolve, reject) => {
      var data = []
      db.each("SELECT hashChainHex FROM jwt WHERE hashChainHex is not null ORDER BY id DESC LIMIT 1", [], function(err, row) {
        data.push({hashChainHex:row.hashChainHex})
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      });
    })
  }

  jwtClaimsAndIdsUnmerkled() {
    return new Promise((resolve, reject) => {
      var data = []
      // Note that we can remove the claim hashHex update once all historical hashes are updated. (... in multiple places)
      db.each("SELECT id, claim, hashHex FROM jwt WHERE hashChainHex is null ORDER BY id", [], function(err, row) {
        data.push({id:row.id, claim:row.claim, hashHex:row.hashHex})
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      });
    })
  }

  jwtSetHash(jwtId, hashHex) {
    return new Promise((resolve, reject) => {
      var stmt = ("UPDATE jwt SET hashHex = ? WHERE id = ?");
      db.run(stmt, [hashHex, jwtId], function(err) {
        if (err) {
          reject(err)
        } else {
          if (this.changes === 1) {
            resolve(hashHex)
          } else {
            reject("Expected to update 1 row but updated " + this.changes)
          }
        }
      })
    })
  }

  jwtSetMerkleHash(jwtId, hashHex, hashChainHex) {
    // Note that we can remove the claim hashHex update once all historical hashes are updated. (... in multiple places)
    return new Promise((resolve, reject) => {
      var stmt = ("UPDATE jwt SET hashHex = ?, hashChainHex = ? WHERE id = ?");
      db.run(stmt, [hashHex, hashChainHex, jwtId], function(err) {
        if (err) {
          reject(err)
        } else {
          if (this.changes === 1) {
            resolve(hashHex)
          } else {
            reject("Expected to update 1 row but updated " + this.changes)
          }
        }
      })
    })
  }




  /****************************************************************
   * Org Role
   **/

  async orgRoleInsert(entity) {
    return new Promise((resolve, reject) => {
      var stmt = ("INSERT INTO org_role_claim (jwtId, issuerDid, orgName, roleName, startDate, endDate, memberDid) VALUES (?, ?, ?, ?, ?, ?, ?)");
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
          resolve({id:row.rowid, jwtId:row.jwtId, partyDid:row.partyDid, polygon:row.polygon})
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
        data.push({id:row.rowid, jwtId:row.jwtId, claimContext:row.claimContext, claimType:row.claimType, issuerDid:row.issuerDid, partyDid:row.partyDid, polygon:row.polygon, westlon:row.westlon, minlat:row.minlat, eastlon:row.eastlon, maxlat:row.maxlat})
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
      var stmt = ("INSERT INTO tenure_claim (jwtId, issuerDid, partyDid, polygon, westlon, minlat, eastlon, maxlat) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      db.run(stmt, [entity.jwtId, entity.issuerDid, entity.partyDid, entity.polygon, entity.westLon, entity.minLat, entity.eastLon, entity.maxLat], function(err) {
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
      var stmt = ("INSERT INTO vote_claim (jwtId, issuerDid, actionOption, candidate, eventName, eventStartTime) VALUES (?, ?, ?, ?, ?, datetime(?))");
      db.run(stmt, [entity.jwtId, entity.issuerDid, entity.actionOption, entity.candidate, entity.eventName, entity.eventStartTime], function(err) {
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
    If the pair already exists, will resolve (instead of rejecting).
   **/
  async networkInsert(subject, object, url) {
    return new Promise((resolve, reject) => {
      var stmt = ("INSERT OR IGNORE INTO network VALUES (?, ?, ?)")
      db.run(stmt, [subject, object, url], function(err) {
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

  async networkDelete(subject, object, url) {
    return new Promise((resolve, reject) => {
      var stmt = ("DELETE FROM network WHERE subject = ? AND object = ?")
      db.run(stmt, [subject, object], function(err) {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  // return all objects that subject can explicitly see
  async getSeenBy(subject) {
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

  // return all {did, url} records that are seen by everyone
  async getSeenByAll() {
    return new Promise((resolve, reject) => {
      var data = []
      db.each("SELECT object, url FROM network WHERE subject = ? ORDER BY object", [this.ALL_SUBJECT_MATCH()], function(err, row) {
        data.push({did: row.object, url: row.url})
      }, function(err, num) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }

  // return all subjects that can see object
  async getWhoCanSee(object) {
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
