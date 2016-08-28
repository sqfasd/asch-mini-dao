var TransactionTypes = require("../helpers/transaction-types.js");

var private = {}, self = null,
	library = null, modules = null;

var BURN_POINTS = 100000000;
var projectVotes = {};
var votedSet = {};

function Vote(cb, _library) {
	self = this;
	library = _library;
	cb(null, self);
}

Vote.prototype.create = function (data, trs) {
	trs.recipientId = null;
	trs.amount = 0;

	trs.asset.vote = {
		project: data.project
	}

	return trs;
}

Vote.prototype.calculateFee = function (trs) {
	return 0;
}

Vote.prototype.verify = function (trs, sender, cb, scope) {
	if (trs.recipientId) {
		return cb("Recipient should not exist");
	}
	if (trs.amount != 0) {
		return cb("Amount should be zero");
	}
	if (!trs.asset.vote.project) {
		return cb("Vote project must have a name");
	}
	if (trs.asset.vote.project.length > 16) {
		return cb("Vote project name must be 16 characters or less");
	}
	cb(null, trs);
}

Vote.prototype.getBytes = function (trs) {
	try {
		var buf = new Buffer(trs.asset.vote.project, "utf8");
	} catch (e) {
		throw Error(e.toString());
	}

	return buf;
}

Vote.prototype.apply = function (trs, sender, cb, scope) {
	modules.blockchain.accounts.mergeAccountAndGet({
		address: sender.address,
		balance: {"POINTS": -BURN_POINTS}
	}, function (err, account) {
		if (!err) {
			if (!projectVotes[trs.asset.vote.project]) {
				projectVotes[trs.asset.vote.project] = 0;
			}
			projectVotes[trs.asset.vote.project]++;
		}
		cb(err, account);
	}, scope);
}

Vote.prototype.undo = function (trs, sender, cb, scope) {
	if (projectVotes[trs.asset.vote.project]) {
		projectVotes[trs.asset.vote.project]--;
	}
	modules.blockchain.accounts.mergeAccountAndGet({
		address: sender.address,
		balance: {"POINTS": BURN_POINTS}
	}, cb, scope);
}

Vote.prototype.applyUnconfirmed = function (trs, sender, cb, scope) {
	if (sender.u_balance["POINTS"] < BURN_POINTS) {
		return setImmediate(cb, "Account does not have enough POINTS: " + trs.id);
	}
	var voteKey = sender.address + ':' + trs.asset.vote.project;
	if (votedSet[voteKey]) {
		return setImmediate(cb, "Project already voted");
	}
	modules.blockchain.accounts.mergeAccountAndGet({
		address: sender.address,
		u_balance: { "POINTS": -BURN_POINTS }
	}, function (err, accounts) {
		if (!err) {
			votedSet[voteKey] = true;
		}
		cb(err, accounts);
	}, scope);
}

Vote.prototype.undoUnconfirmed = function (trs, sender, cb, scope) {
	var voteKey = sender.address + ':' + trs.asset.vote.project;
	delete votedSet[voteKey];
	modules.blockchain.accounts.mergeAccountAndGet({
		address: sender.address,
		u_balance: { "POINTS": BURN_POINTS }
	}, cb, scope);
}

Vote.prototype.ready = function (trs, sender, cb, scope) {
	setImmediate(cb);
}

Vote.prototype.save = function (trs, cb) {
	modules.api.sql.insert({
		table: "asset_vote",
		values: {
			project: trs.asset.vote.project,
			transactionId: trs.id
		}
	}, cb);
}

Vote.prototype.dbRead = function (row) {
	if (!row.t_v_transactionId) {
		return null;
	}
	return {
		vote: {
			project: row.t_v_project,
		}
	};
}

Vote.prototype.normalize = function (asset, cb) {
	setImmediate(cb);
}

Vote.prototype.onBind = function (_modules) {
	modules = _modules;
	modules.logic.transaction.attachAssetType(TransactionTypes.VOTE, self);
}

Vote.prototype.getVotes = function (name) {
	return projectVotes[name] || 0;
}

Vote.prototype.add = function (cb, query) {
	if (!query.secret || !query.name) {
		return cb("Invalid params");
	}
	var keypair = modules.api.crypto.keypair(query.secret);

	library.sequence.add(function (cb) {
		modules.blockchain.accounts.getAccount({publicKey: keypair.publicKey.toString("hex")}, function (err, account) {
			if (err) {
				return cb(err.toString());
			}
			if (!account || !account.publicKey) {
				return cb("Account not found");
			}

			try {
				var transaction = modules.logic.transaction.create({
					type: TransactionTypes.VOTE,
					sender: account,
					keypair: keypair,
					project: query.name
				});
			} catch (e) {
				return cb(e.toString());
			}

			modules.blockchain.transactions.processUnconfirmedTransaction(transaction, cb)
		});
	}, function (err, transaction) {
		if (err) {
			return cb(err.toString());
		}

		cb(null, {transaction: transaction});
	});
}

module.exports = Vote;
