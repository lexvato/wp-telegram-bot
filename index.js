const url = require( 'url' );
const TelegramBot = require( 'node-telegram-bot-api' );
const FeedParser = require( 'feedparser' );
const request = require( 'request' );
const debug = require( 'debug' )( 'wp-telegram-bot' );
const db = require( './database' );


// replace the value below with the Telegram token you receive from @BotFather
const token = require( './secrets.json' ).BOT_TOKEN;

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot( token, { polling: true } );

const blogsToPoll = {};
const POLL_INTERVAL = 5 * 60 * 1000;

( function blogWatcher() {
	const now = Date.now();
	for ( let blogId in blogsToPoll ) {
		let blog = blogsToPoll[ blogId ];
		if ( now - blog.lastCheck > POLL_INTERVAL ) {
			getFeed( blog.feedUrl, ( error, items, meta ) => {
				if ( error ) return;
				updateChannel( blog.chatId, items, meta );
			} );
			blog.lastCheck = now;
			setTimeout( blogWatcher, 100 );
			return;
		}
	}
} )();

function pollBlog( chatId, feedUrl ) {
	blogsToPoll[ chatId ] = {
		chatId,
		feedUrl,
		lastCheck: 0,
	};
}

function updateChannel( chatId, rssItems, meta ) {
	// TODO: search for items that have not been shared yet
	if ( rssItems.length > 0 ) {
		bot.sendMessage( chatId, rssItems[0].link );
	}
}

function followBlog( chatId, chatType, blogUrl ) {
	const feedUrl = getFeedUrl( blogUrl );

	// check that the feed url is accessible
	getFeed( feedUrl, ( error, items, meta ) => {
		if ( error ) return;

		updateChannel( chatId, items, meta );

		db.followBlog( chatId, chatType, feedUrl );

		pollBlog( chatId, feedUrl );
	} );
}

function getFeedUrl( blogUrl ) {
	return url.resolve( blogUrl, './feed' );
}

function getFeed( feedUrl, callback ) {
	const feedRequest = request( feedUrl );
	const feedparser = new FeedParser();
	const items = [];
	let meta = null;

	feedRequest.on( 'error', callback );
	feedRequest.on( 'response', ( response ) => {
		if ( response.statusCode !== 200 ) {
			callback( new Error( 'Bad status code' ) );
		} else {
			feedRequest.pipe( feedparser );
		}
	} );

	feedparser.on( 'error', callback );
	feedparser.on( 'readable', () => {
		let item;

		while ( item = feedparser.read() ) {
			items.push( item );
		}

		meta = feedparser.meta;
	} );
	feedparser.on( 'end', () => callback( null, items, meta ) );
}

function getUrlFromMsgText( msgText ) {
	const reResult = /follow ((http|https):\/\/\S+)/gi.exec( msgText );
	if ( reResult && reResult.length >= 2 ) {
		return reResult[ 1 ];
	}
	return null;
}

bot.on( 'message', msg => {

	if ( msg.chat.type !== 'group' ) {
		return;
	}

	const url = getUrlFromMsgText( msg.text );

	if ( ! url ) {
		return;
	}

	bot.getChatAdministrators( msg.chat.id )
	.then( administrators => {
		if ( administrators.filter( admin => admin.user.username === msg.from.username ).length === 0 ) {
				return Promise.reject( new Error( 'You need to be an administrator of the channel to do that' ) );
			}
		} )
		.then( () => followBlog( msg.chat.id, 'group', url ) )
		.then( () => bot.sendMessage( msg.chat.id, 'Following!' ) )
		.catch( error => bot.sendMessage( msg.chat.id, 'Error: ' + error.message ) );

} );

bot.on( 'channel_post', ( msg ) => {
	// ignore messages from groups
	if ( msg.chat.type !== 'channel' ) {
		return;
	}

	const url = getUrlFromMsgText( msg.text );

	if ( ! url ) {
		return;
	}

	debug( 'Following ' + url );

	// only admins can post to channel
	followBlog( msg.chat.id, 'channel', url );
	bot.sendMessage( msg.chat.id, 'Following!' );

} );

