var TransactionTypes = require("../helpers/transaction-types.js");

var private = {}, self = null,
	library = null, modules = null;

private.uProjects = {};

var BURN_POINTS = 100000000;

function Project(cb, _library) {
	self = this;
	library = _library;
	cb(null, self);
}

Project.prototype.create = function (data, trs) {
	trs.recipientId = null;
	trs.amount = 0;

	trs.asset.project = {
		name: data.name,
		description: data.description
	}

	return trs;
}

Project.prototype.calculateFee = function (trs) {
	return 0;
}

Project.prototype.verify = function (trs, sender, cb, scope) {
	if (trs.recipientId) {
		return cb("Recipient should not exist");
	}
	if (trs.amount != 0) {
		return cb("Amount should be zero");
	}
	if (!trs.asset.project.name) {
		return cb("Project must have a name");
	}
	if (trs.asset.project.name.length > 16) {
		return cb("Project name must be 16 characters or less");
	}
	if (!trs.asset.project.description) {
		return cb("Invalid project description");
	}
	if (trs.asset.project.description.length > 1024) {
		return cb("Project description must be 1024 characters or less");
	}
	cb(null, trs);
}

Project.prototype.getBytes = function (trs) {
	try {
		var buf = new Buffer(trs.asset.project.name + trs.asset.project.description, "utf8");
	} catch (e) {
		throw Error(e.toString());
	}

	return buf;
}

Project.prototype.apply = function (trs, sender, cb, scope) {
	modules.blockchain.accounts.mergeAccountAndGet({
		address: sender.address,
		balance: {"POINTS": -BURN_POINTS}
	}, cb, scope);
}

Project.prototype.undo = function (trs, sender, cb, scope) {
	modules.blockchain.accounts.mergeAccountAndGet({
		address: sender.address,
		balance: {"POINTS": BURN_POINTS}
	}, cb, scope);
}

Project.prototype.applyUnconfirmed = function (trs, sender, cb, scope) {
	if (sender.u_balance["POINTS"] < BURN_POINTS) {
		return setImmediate(cb, "Account does not have enough POINTS: " + trs.id);
	}
	if (private.uProjects[trs.asset.project.name]){
		return setImmediate(cb, "Project already exists");
	}
	modules.blockchain.accounts.mergeAccountAndGet({
		address: sender.address,
		u_balance: { "POINTS": -BURN_POINTS }
	}, function (err, accounts) {
		if (!err) {
			private.uProjects[trs.asset.project.name] = trs;
		}
		cb(err, accounts);
	}, scope);
}

Project.prototype.undoUnconfirmed = function (trs, sender, cb, scope) {
	delete private.uProjects[trs.asset.project.name];
	modules.blockchain.accounts.mergeAccountAndGet({
		address: sender.address,
		u_balance: { "POINTS": BURN_POINTS }
	}, cb, scope);
}

Project.prototype.ready = function (trs, sender, cb, scope) {
	setImmediate(cb);
}

Project.prototype.save = function (trs, cb) {
	modules.api.sql.insert({
		table: "asset_project",
		values: {
			name: trs.asset.project.name,
			description: trs.asset.project.description,
			transactionId: trs.id
		}
	}, cb);
}

Project.prototype.dbRead = function (row) {
	if (!row.t_p_transactionId) {
		return null;
	}
	return {
		project: {
			name: row.t_p_name,
			description: row.t_p_description,
		}
	};
}

Project.prototype.normalize = function (asset, cb) {
	setImmediate(cb);
}

Project.prototype.onBind = function (_modules) {
	modules = _modules;
	modules.logic.transaction.attachAssetType(TransactionTypes.PROJECT, self);
}

Project.prototype.add = function (cb, query) {
	if (!query.secret || !query.name || !query.description) {
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
					type: TransactionTypes.PROJECT,
					sender: account,
					keypair: keypair,
					name: query.name,
					description: query.description
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

Project.prototype.list = function (cb, query) {
	var condition = {
		type: TransactionTypes.PROJECT
	};
	if (query.senderId) {
		condition.senderId = query.senderId;
	}
	modules.api.sql.select({
		table: "transactions",
		alias: "t",
		condition: condition,
		join: [{
			type: "left outer",
			table: "asset_project",
			alias: "tp",
			on: { "t.id": "tp.transactionId" }
		}],
		fields: [
			{"t.id": "id"},
			{"t.senderId": "ownerId"},
			{"tp.name": "name"},
			{"tp.description": "description"}
		]
	},
	{
		"id": String,
		"ownerId": String,
		"name": String,
		"description": String
	}, function (err, projects) {
		if (err) {
			return cb(err.toString());
		}

		projects.forEach(function (p) {
			p.votes = modules.contracts.vote.getVotes(p.name);
		});
		return cb(null, {
			projects: projects
		})
	});
}

module.exports = Project;
