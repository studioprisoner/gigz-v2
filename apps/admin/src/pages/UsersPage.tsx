import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
// Temporary mock data for development
const mockUsers = {
  users: [
    {
      id: '1',
      name: 'John Doe',
      email: 'john@example.com',
      status: 'active',
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      _count: { attendances: 23 }
    },
    {
      id: '2',
      name: 'Jane Smith',
      email: 'jane@example.com',
      status: 'active',
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      _count: { attendances: 45 }
    }
  ],
  total: 2
};
import { formatDate, formatNumber } from '@/lib/utils';
import { Search, UserCheck, UserX, Eye } from 'lucide-react';

export function UsersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  // Mock data for development
  const users = mockUsers;
  const isLoading = false;
  const refetch = () => console.log('Refetch users');

  const suspendMutation = {
    mutateAsync: async ({ userId }: { userId: string }) => {
      console.log('Suspend user:', userId);
    },
    isPending: false,
  };

  const unsuspendMutation = {
    mutateAsync: async ({ userId }: { userId: string }) => {
      console.log('Unsuspend user:', userId);
    },
    isPending: false,
  };

  const handleSuspend = async (userId: string) => {
    if (confirm('Are you sure you want to suspend this user?')) {
      await suspendMutation.mutateAsync({ userId });
    }
  };

  const handleUnsuspend = async (userId: string) => {
    await unsuspendMutation.mutateAsync({ userId });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">User Management</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Manage user accounts and monitor user activity
        </p>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Search Users</CardTitle>
          <CardDescription>Search by name, email, or user ID</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex space-x-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search users..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button onClick={() => refetch()}>Search</Button>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            {users?.total ? `${formatNumber(users.total)} total users` : 'Loading...'}
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
          ) : users?.users?.length ? (
            <div className="space-y-4">
              {users.users.map((user: any) => (
                <div
                  key={user.id}
                  className="border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="flex-shrink-0">
                        <div className="h-10 w-10 bg-gray-300 rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium text-gray-700">
                            {user.name?.charAt(0) || 'U'}
                          </span>
                        </div>
                      </div>
                      <div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                          {user.name || 'Unknown User'}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {user.email}
                        </p>
                        <div className="flex items-center space-x-4 mt-1">
                          <span className="text-xs text-gray-500">
                            Joined: {formatDate(user.createdAt)}
                          </span>
                          {user.lastLoginAt && (
                            <span className="text-xs text-gray-500">
                              Last login: {formatDate(user.lastLoginAt)}
                            </span>
                          )}
                          <span className="text-xs text-gray-500">
                            {formatNumber(user._count?.attendances || 0)} concerts
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      {user.status && (
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            user.status === 'active'
                              ? 'bg-green-100 text-green-800'
                              : user.status === 'suspended'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {user.status}
                        </span>
                      )}

                      <Button variant="outline" size="sm">
                        <Eye className="h-4 w-4 mr-1" />
                        View
                      </Button>

                      {user.status === 'suspended' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleUnsuspend(user.id)}
                          disabled={unsuspendMutation.isPending}
                        >
                          <UserCheck className="h-4 w-4 mr-1" />
                          Unsuspend
                        </Button>
                      ) : (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleSuspend(user.id)}
                          disabled={suspendMutation.isPending}
                        >
                          <UserX className="h-4 w-4 mr-1" />
                          Suspend
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Pagination */}
              {users.total > limit && (
                <div className="flex items-center justify-between mt-6">
                  <div className="text-sm text-gray-500">
                    Showing {(page - 1) * limit + 1} to{' '}
                    {Math.min(page * limit, users.total)} of {formatNumber(users.total)} users
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
                      disabled={page * limit >= users.total}
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
              No users found
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}