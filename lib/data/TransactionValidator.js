const assert = require('@barchart/common-js/lang/assert'),
	array = require('@barchart/common-js/lang/array'),
	Decimal = require('@barchart/common-js/lang/Decimal'),
	is = require('@barchart/common-js/lang/is');

const InstrumentType = require('./InstrumentType'),
	PositionDirection = require('./PositionDirection'),
	TransactionType = require('./TransactionType');

module.exports = (() => {
	'use strict';

	/**
	 * Static utilities for validating transactions.
	 *
	 * @public
	 */
	class TransactionValidator {
		constructor() {

		}

		/**
		 * Determines the desired sequence number for a transaction.
		 *
		 * @public
		 * @param {Object} transaction
		 * @return {Number}
		 */
		static getSortSequence(transaction) {
			let effective;

			if (is.number(transaction.resequence)) {
				effective = transaction.resequence;
			} else {
				effective = transaction.sequence;
			}

			return effective;
		}

		/**
		 * Given an array of transactions, ensures that all sequence numbers and dates
		 * are properly ordered.
		 *
		 * @public
		 * @static
		 * @param {Object[]} transactions
		 * @param {Boolean=} strict
		 * @returns {Boolean}
		 */
		static validateOrder(transactions, strict) {
			return TransactionValidator.getInvalidIndex(transactions, strict) < 0;
		}

		/**
		 * Given an array of transactions, when transaction references are present, ensures
		 * that no transactions within the set reference the same transaction.
		 *
		 * @public
		 * @static
		 * @param {Object[]} transactions
		 * @returns {Boolean}
		 */
		static validateReferences(transactions) {
			assert.argumentIsArray(transactions, 'transactions');

			const references = { };

			return transactions.every((t) => {
				let valid = true;

				if (is.object(t.reference) && is.string(t.reference.root) && is.string(t.reference.transaction)) {
					const root = t.reference.root;
					const transaction = t.reference.transaction;

					if (!references.hasOwnProperty(root)) {
						references[root] = [ ];
					}

					const transactions = references[root];

					if (transactions.some(t => t === transaction)) {
						valid = false;
					} else {
						transactions.push(transaction);
					}
				}

				return valid;
			});
		}

		/**
		 * Given an array of transactions, returns the index of the first transaction that with an invalid
		 * sequence number or date.
		 *
		 * @public
		 * @static
		 * @param {Object[]} transactions
		 * @param {Boolean=} strict
		 * @returns {Number}
		 */
		static getInvalidIndex(transactions, strict) {
			assert.argumentIsArray(transactions, 'transactions');
			assert.argumentIsOptional(strict, 'strict', Boolean);

			return transactions.findIndex((t, i, a) => t.sequence !== (i + 1) || (i !== 0 && t.date.getIsBefore(a[ i - 1 ].date)) || (i !== 0 && is.boolean(strict) && strict && t.date.getIsEqual(a[i - 1].date) && t.type.sequence < a[i - 1].type.sequence));
		}

		static getSwitchIndex(transactions, position) {
			assert.argumentIsArray(transactions, 'transactions');
			assert.argumentIsOptional(position, 'position');

			let open;

			if (position) {
				open = position.snapshot.open;
			} else {
				open = Decimal.ZERO;
			}

			let initial;

			if (open.getIsZero()) {
				initial = null;
			} else {
				initial = PositionDirection.for(open);
			}

			return transactions.findIndex((t) => {
				let quantity = t.quantity.absolute();

				if (t.type.sale) {
					quantity = quantity.opposite();
				}

				open = open.add(quantity);

				const current = PositionDirection.for(open);

				if (initial !== null && initial !== current && current !== PositionDirection.EVEN) {
					return true;
				}

				if (initial === null && !open.getIsZero()) {
					initial = current;
				}

				return false;
			});
		}

		/**
		 * Given an instrument type, returns all valid transaction types.
		 *
		 * @static
		 * @public
		 * @param {InstrumentType} instrumentType
		 * @param {Boolean=} userInitiated
		 * @param {PositionDirection=} currentDirection
		 * @returns {TransactionType[]}
		 */
		static getTransactionTypesFor(instrumentType, userInitiated, currentDirection) {
			assert.argumentIsRequired(instrumentType, 'instrumentType', InstrumentType, 'InstrumentType');
			assert.argumentIsOptional(userInitiated, 'userInitiated', Boolean);

			let valid = validTransactionTypes[instrumentType.code] || [ ];

			if (userInitiated) {
				valid = valid.filter(data => data.user === userInitiated);
			}

			if (currentDirection) {
				valid = valid.filter(data => data.directions.some(d => d === currentDirection));
			}

			return valid.map(d => d.type);
		}

		/**
		 * Returns transaction types which can be initiated by the user, regardless
		 * of instrument type.
		 *
		 * @public
		 * @static
		 * @returns {TransactionType[]}
		 */
		static getUserInitiatedTransactionTypes() {
			return array.unique(Object.keys(validTransactionTypes).reduce((types, key) => {
				const instrumentTypes = validTransactionTypes[key];

				instrumentTypes.forEach((data) => {
					if (data.user) {
						types.push(data.type);
					}
				});

				return types;
			}, [ ]));
		}

		/**
		 * Determines if a transaction type is applicable to an instrument type.
		 *
		 * @static
		 * @public
		 * @param {InstrumentType} instrumentType
		 * @param {TransactionType} transactionType
		 * @param {Boolean=} userInitiated
		 * @returns {Boolean}
		 */
		static validateTransactionType(instrumentType, transactionType, userInitiated) {
			assert.argumentIsRequired(transactionType, 'transactionType', TransactionType, 'TransactionType');

			const transactionTypes = TransactionValidator.getTransactionTypesFor(instrumentType, userInitiated);

			return transactionTypes.some(t => t === transactionType);
		}

		/**
		 * Determines if a transaction type is valid as the first transaction of
		 * a position.
		 *
		 * @public
		 * @param {TransactionType} transactionType
		 * @returns {Boolean}
		 */
		static validateInitialTransactionType(transactionType) {
			return transactionType.initial;
		}

		/**
		 * Determines if a position for a given instrument type can exist in
		 * the given direction.
		 *
		 * @static
		 * @public
		 * @param {InstrumentType} instrumentType
		 * @param {PositionDirection} direction
		 * @returns {Boolean}
		 */
		static validateDirection(instrumentType, direction) {
			assert.argumentIsRequired(instrumentType, 'instrumentType', InstrumentType, 'InstrumentType');
			assert.argumentIsRequired(direction, 'direction', PositionDirection, 'PositionDirection');

			return validDirections[instrumentType.code].some(d => d === direction);
		}

		/**
		 * Determines if the position switches direction and if the direction switch
		 * is valid.
		 *
		 * @static
		 * @public
		 * @param {InstrumentType} instrumentType
		 * @param {PositionDirection|null|undefined} currentDirection
		 * @param {PositionDirection} proposedDirection
		 * @returns {Boolean}
		 */
		static validateDirectionSwitch(instrumentType, currentDirection, proposedDirection) {
			return currentDirection === null || instrumentType.canSwitchDirection || (currentDirection.closed || proposedDirection.closed || currentDirection.positive === proposedDirection.positive);
		}

		toString() {
			return '[TransactionValidator]';
		}
	}

	const validTransactionTypes = { };

	function associateTypes(instrumentType, transactionType, userInitiated, directions) {
		const instrumentTypeCode = instrumentType.code;

		if (!validTransactionTypes.hasOwnProperty(instrumentTypeCode)) {
			validTransactionTypes[instrumentTypeCode] = [ ];
		}

		validTransactionTypes[instrumentTypeCode].push({ type: transactionType, user: userInitiated, directions: directions || [ PositionDirection.LONG, PositionDirection.SHORT, PositionDirection.EVEN ]  });
	}

	associateTypes(InstrumentType.CRYPTO, TransactionType.BUY, true, [ PositionDirection.LONG, PositionDirection.EVEN ]);
	associateTypes(InstrumentType.CRYPTO, TransactionType.SELL, true, [ PositionDirection.LONG ]);
	associateTypes(InstrumentType.CRYPTO, TransactionType.SELL_SHORT, true, [ PositionDirection.SHORT, PositionDirection.EVEN ]);
	associateTypes(InstrumentType.CRYPTO, TransactionType.BUY_SHORT, true, [ PositionDirection.SHORT ]);

	associateTypes(InstrumentType.EQUITY, TransactionType.BUY, true, [ PositionDirection.LONG, PositionDirection.EVEN ]);
	associateTypes(InstrumentType.EQUITY, TransactionType.SELL, true, [ PositionDirection.LONG ]);
	associateTypes(InstrumentType.EQUITY, TransactionType.SELL_SHORT, true, [ PositionDirection.SHORT, PositionDirection.EVEN ]);
	associateTypes(InstrumentType.EQUITY, TransactionType.BUY_SHORT, true, [ PositionDirection.SHORT ]);
	associateTypes(InstrumentType.EQUITY, TransactionType.FEE, true, [ PositionDirection.LONG, PositionDirection.SHORT ]);
	associateTypes(InstrumentType.EQUITY, TransactionType.DIVIDEND, false);
	associateTypes(InstrumentType.EQUITY, TransactionType.DIVIDEND_REINVEST, false);
	associateTypes(InstrumentType.EQUITY, TransactionType.DIVIDEND_STOCK, false);
	associateTypes(InstrumentType.EQUITY, TransactionType.SPLIT, false);
	associateTypes(InstrumentType.EQUITY, TransactionType.DELIST, false);
	associateTypes(InstrumentType.EQUITY, TransactionType.MERGER_OPEN, false);
	associateTypes(InstrumentType.EQUITY, TransactionType.MERGER_CLOSE, false);
	associateTypes(InstrumentType.EQUITY, TransactionType.SPINOFF, false);
	associateTypes(InstrumentType.EQUITY, TransactionType.SPINOFF_OPEN, false);

	associateTypes(InstrumentType.EQUITY_OPTION, TransactionType.BUY, true, [ PositionDirection.LONG, PositionDirection.EVEN ]);
	associateTypes(InstrumentType.EQUITY_OPTION, TransactionType.SELL, true, [ PositionDirection.LONG ]);
	associateTypes(InstrumentType.EQUITY_OPTION, TransactionType.SELL_SHORT, true, [ PositionDirection.SHORT, PositionDirection.EVEN ]);
	associateTypes(InstrumentType.EQUITY_OPTION, TransactionType.BUY_SHORT, true, [ PositionDirection.SHORT ]);

	associateTypes(InstrumentType.FUND, TransactionType.BUY, true, [ PositionDirection.LONG, PositionDirection.EVEN ]);
	associateTypes(InstrumentType.FUND, TransactionType.SELL, true, [ PositionDirection.LONG ]);
	associateTypes(InstrumentType.FUND, TransactionType.FEE, true, [ PositionDirection.LONG ]);
	associateTypes(InstrumentType.FUND, TransactionType.FEE_UNITS, false);
	associateTypes(InstrumentType.FUND, TransactionType.DISTRIBUTION_CASH, false);
	associateTypes(InstrumentType.FUND, TransactionType.DISTRIBUTION_REINVEST, false);
	associateTypes(InstrumentType.FUND, TransactionType.DISTRIBUTION_FUND, false);
	associateTypes(InstrumentType.FUND, TransactionType.DELIST, false);
	associateTypes(InstrumentType.FUND, TransactionType.MERGER_OPEN, false);
	associateTypes(InstrumentType.FUND, TransactionType.MERGER_CLOSE, false);
	associateTypes(InstrumentType.FUND, TransactionType.SPINOFF, false);
	associateTypes(InstrumentType.FUND, TransactionType.SPINOFF_OPEN, false);

	associateTypes(InstrumentType.FUTURE, TransactionType.BUY, true, [ PositionDirection.LONG, PositionDirection.EVEN ]);
	associateTypes(InstrumentType.FUTURE, TransactionType.SELL, true, [ PositionDirection.LONG ]);
	associateTypes(InstrumentType.FUTURE, TransactionType.SELL_SHORT, true, [ PositionDirection.SHORT, PositionDirection.EVEN ]);
	associateTypes(InstrumentType.FUTURE, TransactionType.BUY_SHORT, true, [ PositionDirection.SHORT ]);

	associateTypes(InstrumentType.FUTURE_OPTION, TransactionType.BUY, true, [ PositionDirection.LONG, PositionDirection.EVEN ]);
	associateTypes(InstrumentType.FUTURE_OPTION, TransactionType.SELL, true, [ PositionDirection.LONG ]);
	associateTypes(InstrumentType.FUTURE_OPTION, TransactionType.SELL_SHORT, true, [ PositionDirection.SHORT, PositionDirection.EVEN ]);
	associateTypes(InstrumentType.FUTURE_OPTION, TransactionType.BUY_SHORT, true, [ PositionDirection.SHORT ]);

	associateTypes(InstrumentType.OTHER, TransactionType.BUY, true, [ PositionDirection.LONG, PositionDirection.EVEN ]);
	associateTypes(InstrumentType.OTHER, TransactionType.SELL, true, [ PositionDirection.LONG ]);
	associateTypes(InstrumentType.OTHER, TransactionType.INCOME, true, [ PositionDirection.LONG ]);
	associateTypes(InstrumentType.OTHER, TransactionType.FEE, true, [ PositionDirection.LONG ]);
	associateTypes(InstrumentType.OTHER, TransactionType.VALUATION, true, [ PositionDirection.LONG ]);

	associateTypes(InstrumentType.CASH, TransactionType.DEPOSIT, true);
	associateTypes(InstrumentType.CASH, TransactionType.WITHDRAWAL, true);
	associateTypes(InstrumentType.CASH, TransactionType.DEBIT, false);
	associateTypes(InstrumentType.CASH, TransactionType.CREDIT, false);

	const validDirections = { };

	function associateDirections(instrumentType, positionDirection) {
		const instrumentTypeCode = instrumentType.code;

		if (!validDirections.hasOwnProperty(instrumentTypeCode)) {
			validDirections[instrumentTypeCode] = [ ];
		}

		validDirections[instrumentTypeCode].push(positionDirection);
	}

	associateDirections(InstrumentType.CRYPTO, PositionDirection.EVEN);
	associateDirections(InstrumentType.CRYPTO, PositionDirection.LONG);
	associateDirections(InstrumentType.CRYPTO, PositionDirection.SHORT);

	associateDirections(InstrumentType.EQUITY, PositionDirection.EVEN);
	associateDirections(InstrumentType.EQUITY, PositionDirection.LONG);
	associateDirections(InstrumentType.EQUITY, PositionDirection.SHORT);

	associateDirections(InstrumentType.EQUITY_OPTION, PositionDirection.EVEN);
	associateDirections(InstrumentType.EQUITY_OPTION, PositionDirection.LONG);
	associateDirections(InstrumentType.EQUITY_OPTION, PositionDirection.SHORT);

	associateDirections(InstrumentType.FUND, PositionDirection.EVEN);
	associateDirections(InstrumentType.FUND, PositionDirection.LONG);

	associateDirections(InstrumentType.FUTURE, PositionDirection.EVEN);
	associateDirections(InstrumentType.FUTURE, PositionDirection.LONG);
	associateDirections(InstrumentType.FUTURE, PositionDirection.SHORT);

	associateDirections(InstrumentType.FUTURE_OPTION, PositionDirection.EVEN);
	associateDirections(InstrumentType.FUTURE_OPTION, PositionDirection.LONG);
	associateDirections(InstrumentType.FUTURE_OPTION, PositionDirection.SHORT);

	associateDirections(InstrumentType.OTHER, PositionDirection.EVEN);
	associateDirections(InstrumentType.OTHER, PositionDirection.LONG);

	associateDirections(InstrumentType.CASH, PositionDirection.EVEN);
	associateDirections(InstrumentType.CASH, PositionDirection.LONG);
	associateDirections(InstrumentType.CASH, PositionDirection.SHORT);

	return TransactionValidator;
})();
