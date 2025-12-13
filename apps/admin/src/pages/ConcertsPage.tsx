import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDate, formatNumber } from '@/lib/utils';
import { Search, MapPin, Calendar, Users, Edit, Merge } from 'lucide-react';

export function ConcertsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | 'unmatched' | 'duplicates'>('all');
  const limit = 20;

  // TODO: Implement real concert data fetching
  const concerts = { concerts: [], total: 0, stats: { total: 0, unmatched: 0, duplicates: 0, verified: 0 } };
  const isLoading = false;
  const refetch = () => console.log('Refetch concerts');

  const mergeConcertsMutation = { isPending: false };
  const updateConcertMutation = { isPending: false };

  const handleMergeConcerts = async (sourceId: string, targetId: string) => {
    if (confirm('Are you sure you want to merge these concerts? This action cannot be undone.')) {
      console.log('Merge concerts:', sourceId, targetId);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Concert Management</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Manage concert data, resolve duplicates, and curate content
        </p>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Search Concerts</CardTitle>
          <CardDescription>Search by artist, venue, or concert details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex space-x-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search concerts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex space-x-2">
              <Button
                variant={filter === 'all' ? 'default' : 'outline'}
                onClick={() => setFilter('all')}
              >
                All
              </Button>
              <Button
                variant={filter === 'unmatched' ? 'default' : 'outline'}
                onClick={() => setFilter('unmatched')}
              >
                Unmatched
              </Button>
              <Button
                variant={filter === 'duplicates' ? 'default' : 'outline'}
                onClick={() => setFilter('duplicates')}
              >
                Duplicates
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatNumber(concerts?.stats?.total || 0)}
              </div>
              <div className="text-sm text-gray-500">Total Concerts</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">
                {formatNumber(concerts?.stats?.unmatched || 0)}
              </div>
              <div className="text-sm text-gray-500">Unmatched</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">
                {formatNumber(concerts?.stats?.duplicates || 0)}
              </div>
              <div className="text-sm text-gray-500">Duplicates</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {formatNumber(concerts?.stats?.verified || 0)}
              </div>
              <div className="text-sm text-gray-500">Verified</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Concerts List */}
      <Card>
        <CardHeader>
          <CardTitle>Concerts</CardTitle>
          <CardDescription>
            {concerts?.total ? `${formatNumber(concerts.total)} total concerts` : 'Loading...'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                </div>
              ))}
            </div>
          ) : concerts?.concerts?.length ? (
            <div className="space-y-4">
              {concerts.concerts.map((concert: any) => (
                <div
                  key={concert.id}
                  className="border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-2">
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                          {concert.artist?.name || 'Unknown Artist'}
                        </h3>
                        {concert.status && (
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              concert.status === 'verified'
                                ? 'bg-green-100 text-green-800'
                                : concert.status === 'unmatched'
                                ? 'bg-yellow-100 text-yellow-800'
                                : concert.status === 'duplicate'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {concert.status}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600 dark:text-gray-400">
                        <div className="flex items-center space-x-2">
                          <MapPin className="h-4 w-4" />
                          <span>
                            {concert.venue?.name || 'Unknown Venue'}
                            {concert.venue?.city && `, ${concert.venue.city}`}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Calendar className="h-4 w-4" />
                          <span>{formatDate(concert.date)}</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Users className="h-4 w-4" />
                          <span>
                            {formatNumber(concert._count?.attendances || 0)} attendees
                          </span>
                        </div>
                      </div>

                      {concert.description && (
                        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                          {concert.description}
                        </p>
                      )}

                      {concert.duplicates?.length > 0 && (
                        <div className="mt-2">
                          <p className="text-sm font-medium text-red-600">
                            Potential duplicates found:
                          </p>
                          <div className="mt-1 space-y-1">
                            {concert.duplicates.slice(0, 2).map((duplicate: any) => (
                              <div key={duplicate.id} className="text-sm text-gray-500">
                                {duplicate.artist?.name} at {duplicate.venue?.name} on{' '}
                                {formatDate(duplicate.date)}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 ml-4">
                      <Button variant="outline" size="sm">
                        <Edit className="h-4 w-4 mr-1" />
                        Edit
                      </Button>

                      {concert.duplicates?.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            handleMergeConcerts(concert.duplicates[0].id, concert.id)
                          }
                          disabled={mergeConcertsMutation.isPending}
                        >
                          <Merge className="h-4 w-4 mr-1" />
                          Merge
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Pagination */}
              {concerts.total > limit && (
                <div className="flex items-center justify-between mt-6">
                  <div className="text-sm text-gray-500">
                    Showing {(page - 1) * limit + 1} to{' '}
                    {Math.min(page * limit, concerts.total)} of {formatNumber(concerts.total)}{' '}
                    concerts
                  </div>
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      disabled={page === 1}
                      onClick={() => setPage(page - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      disabled={page * limit >= concerts.total}
                      onClick={() => setPage(page + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-center text-gray-500 dark:text-gray-400 py-8">
              No concerts found
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}